import * as repl from 'repl';
import { parseScript as parseJavaScript } from 'esprima';
import * as childProcess from 'child_process';
import MITMProxy from 'mitmproxy';
// import * as v8 from "v8";

import HeapSnapshotParser from '../heap_snapshot_parser';
import { Log, IDriver } from '../../common/interfaces';
import { wait } from '../../common/util';

function forkNodeProcess(): childProcess.ChildProcess {
  let node: childProcess.ChildProcess;
  try {
    node = childProcess.fork(`${__dirname}/sub.js`);

    // attach events
    node.on('message', (msg) => {
      console.log('PARENT got message:', msg);
    });
    node.stdout.on('data', (data) => {
      console.log(`PID[${node.pid}] stdout: ${data}`);
    });
    node.on('close', (code) => {
      console.log(`PID[${node.pid}] child process close all stdio with code ${code}`);
    });
    node.on('exit', (code) => {
      console.log(`PID[${node.pid}] child process exited with code ${code}`);
    });
  } catch (error) {
    console.error("failed to spawn another NodeJS child process");
  }
  return node;
}

export default class NodeDriver implements IDriver {
  public static async Launch(
    log: Log,
    interceptPaths: string[] = [],
    quiet: boolean = true,
  ): Promise<NodeDriver> {
    const mitmProxy = await MITMProxy.Create(undefined, interceptPaths, quiet);

    // Tell mitmProxy to stash data requested through the proxy.
    mitmProxy.stashEnabled = true;

    const nodeProcess = forkNodeProcess();

    const driver = new NodeDriver(
      log,
      interceptPaths,
      mitmProxy,
      nodeProcess,
    );

    return driver;
  }

  private _log: Log;
  public readonly mitmProxy: MITMProxy;
  private _interceptPaths: string[];
  private _quiet: boolean;
  private _process: childProcess.ChildProcess;
  private _shutdown: boolean;

  private constructor(
    log: Log,
    interceptPaths: string[],
    mitmProxy: MITMProxy,
    nodeProcess: childProcess.ChildProcess,
  ) {
    this._log = log;
    this.mitmProxy = mitmProxy;
    this._interceptPaths = interceptPaths;
    this._process = nodeProcess;
    this._shutdown = false;

    log.log("[DEBUG] in constructor, need use:");
    log.log(this._process + "");
    log.log(this._shutdown + "");
  }

  // dummy API
  public async takeScreenshot(): Promise<Buffer> {
    return new Promise<Buffer>(() => {
      return Buffer.from("takeScreenshot not implemented in Node", "base64");
    });
  }

  // dummy API
  public async navigateTo(url: string): Promise<any> {
    await wait(1);
    return new Promise<void>(() => {});
  }

  public async relaunch(): Promise<NodeDriver> {
    await this.shutdown();
    const driver = await NodeDriver.Launch(
      this._log,
      this._interceptPaths,
      this._quiet
    );
    driver.mitmProxy.cb = this.mitmProxy.cb;
    return driver;
  }

  public async runCode<T>(expression: string): Promise<T> {
    // const e = await this._runtime.evaluate({ expression, returnByValue: true });
    // this._log.debug(`${expression} => ${JSON.stringify(e.result.value)}`);
    // if (e.exceptionDetails) {
    //   return Promise.reject(exceptionDetailsToString(e.exceptionDetails));
    // }
    // return e.result.value;
    console.log("[DEBUG node_driver] runCode<T> need implementation to run: ", expression);
    return new Promise<T>(() => {});
  }

  public takeHeapSnapshot(): HeapSnapshotParser {
    console.log("in takeHeapSnapshot");
    const parser = new HeapSnapshotParser();

    this._process.send({ action: 'sayHello' })

    // TODO: take & add snapshot
    // parser.addSnapshotChunk(evt.chunk);

    return parser;
  }
  // private async _takeDOMSnapshot(): Promise<void> {
  //   const response = await this._runtime.evaluate({
  //     expression: "$$$SERIALIZE_DOM$$$()",
  //     returnByValue: true,
  //   });
  //   return response.result.value;
  // }

  public async debugLoop(): Promise<void> {
    const evalJavascript = (
      cmd: string,
      context: any,
      filename: string,
      callback: (e: any, result?: string) => void
    ): void => {
      try {
        parseJavaScript(cmd);
        this.runCode(cmd)
          .then((result) => {
            callback(null, `${result}`);
          })
          .catch(callback);
      } catch (e) {
        callback(new (<any>repl).Recoverable(e));
      }
    };
    return new Promise<void>((resolve, reject) => {
      const r = repl.start({ prompt: "> ", eval: evalJavascript });
      r.on("exit", resolve);
    });
  }

  public async shutdown(): Promise<void> {
    // this._shutdown = true;
    // await Promise.all([this._process.dispose(), this.mitmProxy.shutdown()]);
    return new Promise<void>(() => {
      return "shutdown needs implementation"
    });
  }
}
