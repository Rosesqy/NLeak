import {IProxy, IBrowserDriver, HeapSnapshot, SourceFile, IHTTPResponse} from '../common/interfaces';
import {createSession} from 'chrome-debugging-client';
import {ISession as ChromeSession, IAPIClient as ChromeAPIClient, IBrowserProcess as ChromeProcess, IDebuggingProtocolClient as ChromeDebuggingProtocolClient} from 'chrome-debugging-client/dist/lib/types';
import {HeapProfiler as ChromeHeapProfiler, Network as ChromeNetwork, Console as ChromeConsole, Page as ChromePage, Runtime as ChromeRuntime} from "chrome-debugging-client/dist/protocol/tot";
import {WriteStream} from 'fs';
import {request as HTTPRequest, STATUS_CODES} from 'http';
import {request as HTTPSRequest} from 'https';
import {parse as parseURL} from 'url';

function wait(ms: number): Promise<void> {
  return new Promise<void>((res) => {
    setTimeout(res, ms);
  });
}

/**
 * Makes an HTTP / HTTPS request on behalf of the browser.
 * @param req
 */
async function makeHttpRequest(urlString: string, method: string, headers: any, postData?: string): Promise<IHTTPResponse> {
  // console.log(req);
  const url = parseURL(urlString, false);
  const makeRequest = url.protocol === "https:" ? HTTPSRequest : HTTPRequest;
  // Prune out keep-alive.
  delete headers['connection'];
  return new Promise<IHTTPResponse>((resolve, reject) => {
    const nodeReq = makeRequest({
      protocol: url.protocol,
      host: url.hostname,
      port: +url.port,
      method: method,
      path: url.path,
      headers: headers
    }, (res) => {
      const rv: IHTTPResponse = {
        statusCode: res.statusCode,
        headers: res.headers,
        data: null
      };
      let data: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        data.push(chunk);
      });
      res.on('end', () => {
        rv.data = Buffer.concat(data);
        resolve(rv);
      });
      res.on('error', reject);
    });
    //nodeReq.on('error', reject);
    if (postData) {
      nodeReq.write(postData);
    }
    nodeReq.end();
  });
}

/**
 * Converts the response into a base64 encoded raw response,
 * including HTTP status line and headers etc.
 */
function makeRawResponse(res: IHTTPResponse): string {
  const headers = Buffer.from(`HTTP/1.1 ${res.statusCode} ${STATUS_CODES[res.statusCode]}\r\n` +
                   `${Object.keys(res.headers).map((k) => `${k}: ${res.headers[k]}`).join("\r\n")}\r\n\r\n`, 'ascii');
  const response = Buffer.concat([headers, res.data]);
  return response.toString('base64');
}

export default class ChromeRemoteDebuggingDriver implements IProxy, IBrowserDriver {
  public static async Launch(log: WriteStream): Promise<ChromeRemoteDebuggingDriver> {
    const session = await new Promise<ChromeSession>((res, rej) => createSession(res));
    // spawns a chrome instance with a tmp user data
    // and the debugger open to an ephemeral port
    const process = await session.spawnBrowser("canary", {
      // additionalArguments: ['--headless'],
      windowSize: { width: 1920, height: 1080 }
    });
    // open the REST API for tabs
    const client = session.createAPIClient("localhost", process.remoteDebuggingPort);
    const tabs = await client.listTabs();
    const tab = tabs[0];
    await client.activateTab(tab.id);
    // open the debugger protocol
    // https://chromedevtools.github.io/devtools-protocol/
    const debugClient = await session.openDebuggingProtocol(tab.webSocketDebuggerUrl);

    const heapProfiler = new ChromeHeapProfiler(debugClient);
    const network = new ChromeNetwork(debugClient);
    const console = new ChromeConsole(debugClient);
    const page = new ChromePage(debugClient);
    const runtime = new ChromeRuntime(debugClient);
    await Promise.all([heapProfiler.enable(), network.enable({}),  console.enable(), page.enable(), runtime.enable()]);
    await network.setRequestInterceptionEnabled({ enabled: true });

    return new ChromeRemoteDebuggingDriver(log, session, process, client, debugClient, page, runtime, heapProfiler, network, console);
  }

  private _log: WriteStream;
  private _session: ChromeSession;
  private _process: ChromeProcess;
  private _client: ChromeAPIClient;
  private _debugClient: ChromeDebuggingProtocolClient;
  private _page: ChromePage;
  private _runtime: ChromeRuntime;
  private _heapProfiler: ChromeHeapProfiler;
  private _network: ChromeNetwork;
  private _console: ChromeConsole;
  private _loadedFrames = new Set<string>();
  private _onRequest: (f: SourceFile) => SourceFile = (f) => f;

  private constructor(log: WriteStream, session: ChromeSession, process: ChromeProcess, client: ChromeAPIClient, debugClient: ChromeDebuggingProtocolClient, page: ChromePage, runtime: ChromeRuntime, heapProfiler: ChromeHeapProfiler, network: ChromeNetwork, console: ChromeConsole) {
    this._log = log;
    this._session = session;
    this._process = process;
    this._client = client;
    this._debugClient = debugClient;
    this._runtime = runtime;
    this._page = page;
    this._heapProfiler = heapProfiler;
    this._network = network;
    this._console = console;

    this._console.messageAdded = (evt) => {
      //const m = evt.message;
      //log.write(`[${m.level}] [${m.source}] ${m.url}:${m.line}:${m.column} ${m.text}\n`);
    };

    this._network.requestIntercepted = async (evt) => {
      // global.console.log(evt);
      // If redirect or not get: Allow with no modifications.
      if (evt.redirectHeaders || evt.redirectUrl || evt.request.method.toLowerCase() !== "get") {
        this._network.continueInterceptedRequest({
          interceptionId: evt.interceptionId
        });
      } else {
        // It's a GET request that's not redirected.
        // Attempt to fetch, pass to callback.
        const response = await this.httpGet(evt.request.url, evt.request.headers, evt.request.postData);
        // Send back to client.
        this._network.continueInterceptedRequest({
          interceptionId: evt.interceptionId,
          rawResponse: makeRawResponse(response)
        })
      }
    };

    this._page.frameStoppedLoading = (e) => {
      this._loadedFrames.add(e.frameId);
    };
  }

  async httpGet(url: string, headers: any = { "Host": parseURL(url).host }, body?: string): Promise<IHTTPResponse> {
    const response = await makeHttpRequest(url, 'get', headers, body);
    let mimeType = response.headers['content-type'] as string;
    let statusCode = response.statusCode;
    if (mimeType) {
      mimeType = mimeType.toLowerCase();
      // text/javascript or application/javascript
      if (mimeType.indexOf('text') !== -1 || mimeType.indexOf('application/javascript') !== -1) {
        const newFile = this._onRequest({
          status: statusCode,
          mimetype: mimeType,
          url: url,
          contents: response.data
        });
        response.data = newFile.contents;
        response.headers['content-type'] = newFile.mimetype;
        response.statusCode = newFile.status;
      }
    }
    if (response.headers['content-length']) {
      response.headers['content-length'] = response.data.length;
    }
    // Disable caching.
    // From: https://stackoverflow.com/questions/9884513/avoid-caching-of-the-http-responses
    response.headers['expires'] = 'Tue, 03 Jul 2001 06:00:00 GMT';
    response.headers['last-modified'] = `${(new Date()).toUTCString()}`;
    response.headers['cache-control'] = 'max-age=0, no-cache, must-revalidate, proxy-revalidate';
    return response;
  }

  async navigateTo(url: string): Promise<any> {
    this._loadedFrames.clear();
    const f = await this._page.navigate({ url });
    while (!this._loadedFrames.has(f.frameId)) {
      // console.log(`Waiting for frame...`);
      await wait(5);
    }
  }
  async runCode(expression: string): Promise<string> {
    const e = await this._runtime.evaluate({ expression, returnByValue: true });
    console.log(`${expression} => ${e.result.value}`);
    return `${e.result.value}`;
  }
  async takeHeapSnapshot(): Promise<HeapSnapshot> {
    // TODO: Use buffers instead.
    let buffer = "";
    this._heapProfiler.addHeapSnapshotChunk = (evt) => {
      buffer += evt.chunk;
    };
    await this._heapProfiler.takeHeapSnapshot({ reportProgress: false });
    return JSON.parse(buffer);
  }
  onRequest(cb: (f: SourceFile) => SourceFile): void {
    this._onRequest = cb;
  }

  getHTTPPort(): number {
    return 5554;
  }
  getHTTPSPort(): number {
    return 5555;
  }
  getHost(): string {
    return "localhost";
  }
  shutdown(): PromiseLike<void> {
    return this._process.dispose();
  }

}
