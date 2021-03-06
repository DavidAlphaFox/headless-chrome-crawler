const { unlink, readFile, existsSync } = require('fs');
const assert = require('assert');
const sinon = require('sinon');
const { extend, includes, noop } = require('lodash');
const HCCrawler = require('../');
const RedisCache = require('../cache/redis');
const CSVExporter = require('../exporter/csv');
const JSONLineExporter = require('../exporter/json-line');
const Crawler = require('../lib/crawler');

const URL1 = 'http://www.example.com/';
const URL2 = 'http://www.example.net/';
const URL3 = 'http://www.example.org/';
const CSV_FILE = './tmp/result.csv';
const JSON_FILE = './tmp/result.json';
const ENCODING = 'utf8';

const DEFAULT_OPTIONS = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };

describe('HCCrawler', () => {
  describe('HCCrawler.executablePath', () => {
    it('works', () => {
      const executablePath = HCCrawler.executablePath();
      assert.ok(existsSync(executablePath));
    });
  });

  describe('HCCrawler.defaultArgs', () => {
    it('returns the default chrome arguments', () => {
      const args = HCCrawler.defaultArgs();
      assert.ok(includes(args, '--no-first-run'));
    });
  });

  describe('HCCrawler.launch', () => {
    let crawler;

    afterEach(() => {
      Crawler.prototype.crawl.restore();
    });

    context('when crawling does not fail', () => {
      beforeEach(() => {
        sinon.stub(Crawler.prototype, 'crawl').returns(Promise.resolve({
          options: {},
          result: { title: 'Example Domain' },
          links: ['http://www.iana.org/domains/example'],
          screenshot: null,
        }));
      });

      context('when the crawler is launched without necessary options', () => {
        beforeEach(() => (
          HCCrawler.launch(DEFAULT_OPTIONS)
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('throws an error when queueing null', () => {
          assert.throws(() => {
            crawler.queue(null);
          });
        });

        it('throws an error when queueing options without URL', () => {
          assert.throws(() => {
            crawler.queue();
          });
        });

        it('crawls when queueing necessary options', () => {
          crawler.queue({ url: URL1 });
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 1);
            });
        });
      });

      context('when the crawler is launched with necessary options', () => {
        beforeEach(() => (
          HCCrawler.launch(DEFAULT_OPTIONS)
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('crawls when queueing a string', () => {
          crawler.queue(URL1);
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 1);
            });
        });

        it('crawls when queueing multiple strings', () => {
          crawler.queue([URL1, URL2, URL3]);
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 3);
            });
        });

        it('crawls when queueing an object', () => {
          crawler.queue({ url: URL1 });
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 1);
            });
        });

        it('crawls when queueing multiple objects', () => {
          crawler.queue([{ url: URL1 }, { url: URL2 }, { url: URL3 }]);
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 3);
            });
        });

        it('crawls when queueing mixed styles', () => {
          crawler.queue([URL1, { url: URL2 }]);
          crawler.queue(URL3);
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 3);
            });
        });

        it('throws an error when overriding onSuccess', () => {
          assert.throws(() => {
            crawler.queue({ url: URL1, onSuccess: noop });
          });
        });

        it('throws an error when queueing options with unavailable device', () => {
          assert.throws(() => {
            crawler.queue({ url: URL1, device: 'do-not-exist' });
          });
        });

        it('throws an error when delay is set', () => {
          assert.throws(() => {
            crawler.queue({ url: URL1, delay: 100 });
          });
        });

        it('crawls when the requested domain is allowed', () => {
          let requestskipped = 0;
          crawler.on('requestskipped', () => { requestskipped += 1; });
          crawler.queue({ url: URL1, allowedDomains: ['example.com', 'example.net'] });
          return crawler.onIdle()
            .then(() => {
              assert.equal(requestskipped, 0);
              assert.equal(crawler.requestedCount(), 1);
            });
        });

        it('skips crawling when the requested domain is not allowed', () => {
          let requestskipped = 0;
          crawler.on('requestskipped', () => { requestskipped += 1; });
          crawler.queue({ url: URL1, allowedDomains: ['example.net', 'example.org'] });
          return crawler.onIdle()
            .then(() => {
              assert.equal(requestskipped, 1);
              assert.equal(crawler.requestedCount(), 0);
            });
        });

        it('emits request events', () => {
          let requeststarted = 0;
          let requestfinished = 0;
          crawler.on('requeststarted', () => { requeststarted += 1; });
          crawler.on('requestfinished', () => { requestfinished += 1; });
          crawler.queue(URL1);
          return crawler.onIdle()
            .then(() => {
              assert.equal(requeststarted, 1);
              assert.equal(requestfinished, 1);
            });
        });
      });

      context('when the crawler is launched with preRequest returns true', () => {
        function preRequest() {
          return true;
        }

        beforeEach(() => (
          HCCrawler.launch(extend({ preRequest }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('does not skip crawling', () => {
          let requestskipped = 0;
          crawler.on('requestskipped', () => { requestskipped += 1; });
          crawler.queue(URL1);
          return crawler.onIdle()
            .then(() => {
              assert.equal(requestskipped, 0);
              assert.equal(crawler.requestedCount(), 1);
            });
        });
      });

      context('when the crawler is launched with preRequest returns false', () => {
        function preRequest() {
          return false;
        }

        beforeEach(() => (
          HCCrawler.launch(extend({ preRequest }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('skips crawling', () => {
          let requestskipped = 0;
          crawler.on('requestskipped', () => { requestskipped += 1; });
          crawler.queue(URL1);
          return crawler.onIdle()
            .then(() => {
              assert.equal(requestskipped, 1);
              assert.equal(crawler.requestedCount(), 0);
            });
        });
      });

      context('when the crawler is launched with preRequest modifies options', () => {
        const path = './tmp/example.png';
        function preRequest(options) {
          options.screenshot = { path };
          return true;
        }

        beforeEach(() => (
          HCCrawler.launch(extend({ preRequest }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('modifies options', () => {
          crawler.queue(URL1);
          return crawler.onIdle()
            .then(() => {
              const { screenshot } = Crawler.prototype.crawl.firstCall.thisValue._options;
              assert.deepEqual(screenshot, { path });
            });
        });
      });

      context('when the crawler is launched with device option', () => {
        beforeEach(() => (
          HCCrawler.launch(extend({ device: 'iPhone 6' }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('overrides device by queueing options', () => {
          crawler.queue({ url: URL1, device: 'Nexus 6' });
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 1);
              assert.equal(Crawler.prototype.crawl.firstCall.thisValue._options.device, 'Nexus 6');
            });
        });
      });

      context('when the crawler is launched with maxDepth = 2', () => {
        beforeEach(() => (
          HCCrawler.launch(extend({ maxDepth: 2 }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('automatically follows links', () => {
          let maxdepthreached = 0;
          crawler.on('maxdepthreached', () => { maxdepthreached += 1; });
          crawler.queue(URL1);
          return crawler.onIdle()
            .then(() => {
              assert.equal(maxdepthreached, 1);
              assert.equal(crawler.requestedCount(), 2);
            });
        });
      });

      context('when the crawler is launched with maxConcurrency = 1', () => {
        beforeEach(() => (
          HCCrawler.launch(extend({ maxConcurrency: 1 }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('obeys priority order', () => {
          crawler.queue({ url: URL1, priority: 1 });
          crawler.queue({ url: URL2, priority: 2 });
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 2);
              assert.equal(Crawler.prototype.crawl.firstCall.thisValue._options.url, URL2);
              assert.equal(Crawler.prototype.crawl.secondCall.thisValue._options.url, URL1);
            });
        });

        it('does not throw an error when delay option is set', () => {
          crawler.queue({ url: URL1, delay: 100 });
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 1);
            });
        });
      });

      context('when the crawler is launched with maxRequest option', () => {
        beforeEach(() => (
          HCCrawler.launch(extend({ maxConcurrency: 1, maxRequest: 2 }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('pauses at maxRequest option', () => {
          let maxrequestreached = 0;
          crawler.on('maxrequestreached', () => { maxrequestreached += 1; });
          crawler.queue(URL1);
          crawler.queue(URL2);
          crawler.queue(URL3);
          return crawler.onIdle()
            .then(() => {
              assert.equal(maxrequestreached, 1);
              assert.equal(crawler.isPaused(), true);
              assert.equal(crawler.requestedCount(), 2);
              assert.equal(crawler.pendingQueueSize(), 1);
              return crawler.queueSize();
            })
            .then(size => {
              assert.equal(size, 1);
            });
        });

        it('resumes from maxRequest option', () => {
          crawler.queue(URL1);
          crawler.queue(URL2);
          crawler.queue(URL3);
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.isPaused(), true);
              assert.equal(crawler.requestedCount(), 2);
              assert.equal(crawler.pendingQueueSize(), 1);
              return crawler.queueSize();
            })
            .then(size => {
              assert.equal(size, 1);
              crawler.setMaxRequest(4);
              crawler.resume();
              return crawler.onIdle();
            })
            .then(() => {
              assert.equal(crawler.isPaused(), false);
              assert.equal(crawler.requestedCount(), 3);
              assert.equal(crawler.pendingQueueSize(), 0);
              return crawler.queueSize();
            })
            .then(size => {
              assert.equal(size, 0);
            });
        });
      });

      context('when the crawler is launched with exporter option', () => {
        function removeTemporaryFile(file) {
          return new Promise(resolve => {
            unlink(file, (() => void resolve()));
          });
        }

        function readTemporaryFile(file) {
          return new Promise((resolve, reject) => {
            readFile(file, ENCODING, ((error, result) => {
              if (error) return reject(error);
              return resolve(result);
            }));
          });
        }

        afterEach(() => (
          crawler.close()
            .then(() => removeTemporaryFile(CSV_FILE))
        ));

        context('when the crawler is launched with exporter = CSVExporter', () => {
          beforeEach(() => (
            removeTemporaryFile(CSV_FILE)
              .then(() => {
                const exporter = new CSVExporter({
                  file: CSV_FILE,
                  fields: ['result.title'],
                });
                return HCCrawler.launch(extend({ maxConcurrency: 1, exporter }, DEFAULT_OPTIONS))
                  .then(_crawler => {
                    crawler = _crawler;
                  });
              })
          ));

          it('exports a CSV file', () => {
            crawler.queue(URL1);
            crawler.queue(URL2);
            return crawler.onIdle()
              .then(() => readTemporaryFile(CSV_FILE))
              .then(actual => {
                const header = 'result.title\n';
                const line1 = 'Example Domain\n';
                const line2 = 'Example Domain\n';
                const expected = header + line1 + line2;
                assert.equal(actual, expected);
              });
          });
        });

        context('when the crawler is launched with exporter = JSONLineExporter', () => {
          beforeEach(() => (
            removeTemporaryFile(JSON_FILE)
              .then(() => {
                const exporter = new JSONLineExporter({
                  file: JSON_FILE,
                  fields: ['result.title'],
                });
                return HCCrawler.launch(extend({ maxConcurrency: 1, exporter }, DEFAULT_OPTIONS))
                  .then(_crawler => {
                    crawler = _crawler;
                  });
              })
          ));

          it('exports a json-line file', () => {
            crawler.queue(URL1);
            crawler.queue(URL2);
            return crawler.onIdle()
              .then(() => readTemporaryFile(JSON_FILE))
              .then(actual => {
                const line1 = `${JSON.stringify({ result: { title: 'Example Domain' } })}\n`;
                const line2 = `${JSON.stringify({ result: { title: 'Example Domain' } })}\n`;
                const expected = line1 + line2;
                assert.equal(actual, expected);
              });
          });
        });
      });

      context('when the crawler is launched with default cache', () => {
        beforeEach(() => (
          HCCrawler.launch(extend({ maxConcurrency: 1 }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('does not crawl already cached url', () => {
          crawler.queue(URL1);
          crawler.queue(URL2);
          crawler.queue(URL1); // The queue won't be requested
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 2);
            });
        });
      });

      context('when the crawler is launched with redis cache', () => {
        context('for the fist time with persistCache = true', () => {
          beforeEach(() => {
            const cache = new RedisCache();
            return HCCrawler.launch(extend({ cache, persistCache: true }, DEFAULT_OPTIONS))
              .then(_crawler => {
                crawler = _crawler;
                return crawler.clearCache();
              });
          });

          afterEach(() => crawler.close());

          it('crawls all queued urls', () => {
            crawler.queue(URL1);
            crawler.queue(URL2);
            return crawler.onIdle()
              .then(() => {
                assert.equal(crawler.requestedCount(), 2);
              });
          });
        });

        context('for the second time', () => {
          beforeEach(() => {
            const cache = new RedisCache();
            return HCCrawler.launch(extend({ cache }, DEFAULT_OPTIONS))
              .then(_crawler => {
                crawler = _crawler;
              });
          });

          afterEach(() => crawler.close());

          it('does not crawl already cached url', () => {
            crawler.queue(URL2);
            crawler.queue(URL3);
            return crawler.onIdle()
              .then(() => {
                assert.equal(crawler.requestedCount(), 1);
              });
          });
        });
      });

      context('when the crawler is with skipDuplicates = false', () => {
        beforeEach(() => (
          HCCrawler.launch(extend({ maxConcurrency: 1, skipDuplicates: false }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('crawls duplicate urls', () => {
          crawler.queue(URL1);
          crawler.queue(URL2);
          crawler.queue(URL1); // The queue will be requested
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 3);
            });
        });
      });

      context('when the crawler is launched with onSuccess', () => {
        const onSuccess = sinon.spy();

        beforeEach(() => (
          HCCrawler.launch(extend({ onSuccess }, DEFAULT_OPTIONS))
            .then(_crawler => {
              crawler = _crawler;
            })
        ));

        afterEach(() => crawler.close());

        it('does not skip crawling', () => {
          crawler.queue(URL1);
          return crawler.onIdle()
            .then(() => {
              assert.equal(crawler.requestedCount(), 1);
              assert.equal(onSuccess.callCount, 1);
            });
        });
      });

      it('emits disconnect event', () => {
        let disconnected = 0;
        return HCCrawler.launch(DEFAULT_OPTIONS)
          .then(_crawler => {
            crawler = _crawler;
          })
          .then(() => void crawler.on('disconnected', () => { disconnected += 1; }))
          .then(() => crawler.close())
          .then(() => void assert.equal(disconnected, 1));
      });
    });

    context('when crawling fails', () => {
      const onError = sinon.spy();

      beforeEach(() => {
        const error = new Error('Unexpected error occured while crawling!');
        sinon.stub(Crawler.prototype, 'crawl').returns(Promise.reject(error));
        return HCCrawler.launch(extend({ onError }, DEFAULT_OPTIONS))
          .then(_crawler => {
            crawler = _crawler;
          });
      });

      afterEach(() => crawler.close());

      it('retries and gives up', () => {
        let requestretried = 0;
        let requestfailed = 0;
        crawler.on('requestretried', () => { requestretried += 1; });
        crawler.on('requestfailed', () => { requestfailed += 1; });
        crawler.queue({ url: URL1, retryCount: 3, retryDelay: 100 });
        return crawler.onIdle()
          .then(() => {
            assert.equal(crawler.requestedCount(), 1);
            assert.equal(requestretried, 3);
            assert.equal(requestfailed, 1);
            assert.equal(onError.callCount, 1);
          });
      });
    });
  });
});
