import createHTTPServer from './util/http_server';
import {Server as HTTPServer} from 'http';
import NodeDriver from '../src/lib/driver/node_driver';
import {equal as assertEqual} from 'assert';
import NopLog from '../src/common/nop_log';

const HTTP_PORT = 8890;

describe("Chrome Driver", function() {
  // 30 second timeout.
  this.timeout(30000);
  let httpServer: HTTPServer;
  let nodeDriver: NodeDriver;
  before(async function() {
    httpServer = await createHTTPServer({
      "/": {
        mimeType: "text/html",
        data: Buffer.from("<!doctype html><html><div id='container'>ContainerText</div></html>", "utf8")
      }
    }, HTTP_PORT);
    // Silence debug messages.
    console.debug = () => {};
    nodeDriver = await NodeDriver.Launch(NopLog);
  });

  it("Successfully loads a webpage", async function() {
    await nodeDriver.navigateTo(`http://localhost:${HTTP_PORT}/`);
    const str = await nodeDriver.runCode("document.getElementById('container').innerText");
    assertEqual(str, "ContainerText");
  });

  after(async function() {
    return new Promise<void>((resolve, reject) => {
      function closeChrome() {
        if (nodeDriver) {
          nodeDriver.shutdown().then(resolve, reject);
        } else {
          resolve();
        }
      }
      function closeHttpServer() {
        if (httpServer) {
          httpServer.close(closeChrome);
        } else {
          closeChrome();
        }
      }
      closeHttpServer();
    });
  });
});
