import {CommandModule} from 'yargs';
import BLeak from '../../lib/bleak';
import NodeDriver from '../../lib/driver/node_driver';
import ProgressProgressBar from '../../lib/progress_progress_bar';
import {readFileSync, writeFileSync} from 'fs';
import BLeakResults from '../../lib/bleak_results';
import {DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL, DEFAULT_AGENT_TRANSFORM_URL} from '../../lib/mitmproxy_interceptor';

interface CommandLineArgs {
  config: string;
  results: string;
  debug: boolean;
  headless: boolean;
  'resume-after-failure': boolean;
}

const EvaluateMetrics: CommandModule = {
  command: 'evaluate-metrics',
  describe: 'Evaluates the performance of different leak ranking metrics.',
  builder: {
    config: {
      type: 'string',
      demand: true,
      describe: 'Path to a BLeak configuration file. Must contain a fixMap property.'
    },
    results: {
      type: 'string',
      demand: true,
      describe: 'Path to a bleak_results.json from a completed run.'
    },
    debug: {
      type: 'boolean',
      default: false,
      describe: 'If set, print debug information to console.'
    },
    headless: {
      type: 'boolean',
      default: false,
      describe: 'Run in Chrome Headless (currently buggy)'
    },
    'resume-after-failure': {
      type: 'boolean',
      default: false,
      describe: 'If a failure occurs, automatically resume the process until it completes'
    }
  },
  handler: async function handler(args: CommandLineArgs) {
    const progressBar = new ProgressProgressBar(args.debug, false);
    const nodeDriver = await NodeDriver.Launch(progressBar, [DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL, DEFAULT_AGENT_TRANSFORM_URL], !args.debug);
    const configFileSource = readFileSync(args.config).toString();
    const results = BLeakResults.FromJSON(JSON.parse(readFileSync(args.results, 'utf8')));

    let shuttingDown = false;
    async function shutDown() {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      await nodeDriver.shutdown();
      // All sockets/subprocesses/resources *should* be closed, so we can just exit.
      process.exit(0);
    }
    // Shut down gracefully on CTRL+C.
    process.on('SIGINT', async function sigintHandler() {
      progressBar.log(`CTRL+C received.`);
      // Fix memory leak when resume-after-failure is active.
      process.removeListener('SIGINT', sigintHandler);
      shutDown();
    });

    BLeak.EvaluateRankingMetrics(configFileSource, progressBar, nodeDriver, results, (results) => {
      writeFileSync(args.results, Buffer.from(JSON.stringify(results), 'utf8'));
    }).then(shutDown).catch((e) => {
      progressBar.error(`${e}`);
      if (args['resume-after-failure']) {
        progressBar.log(`Resuming...`);
        shuttingDown = true;
        nodeDriver.shutdown().then(() => {
          handler(args);
        }).catch(() => {
          handler(args);
        });
      } else {
        progressBar.error(`${e}`);
        shutDown();
      }
    });
  }
};

export default EvaluateMetrics;
