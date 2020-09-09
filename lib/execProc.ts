import {returnStringType} from './helpers';
import {millisecondsToMinutes} from './utils'
import {execute} from './exec';
import {logger} from './logger';
import {ProcessRerunError} from './error';

function buildExecRunner(notRetriable, runOpts) {
  const {
    formCommanWithOption,
    currentExecutionVariable,
    longestProcessTime,
    debugProcess,
    processResultAnalyzer,
    execOpts = {maxBuffer: 1000 * 1024},
    pollTime,
    successExitCode = 0
  } = runOpts;

  if ((typeof successExitCode) !== 'number') {
    throw new ProcessRerunError('Type', 'successExitCode should be a number');
  }

  return (cmd, index) => new Promise((resolve) => {
    // TODO
    let additionalOpts = null;
    let originalCmd = cmd;
    let onErrorCloseHandler = null;

    const executionHolder = {stackTrace: ''};
    /**
     * @now this variable will be used for process kill if time more than @longestProcessTime
     */
    const startTime = +Date.now();

    /**
     * @param {undefined|function} addSpecificOptions if function cmd will go to this function as argument
     */
    if (formCommanWithOption) {
      const cmdObj = formCommanWithOption(cmd);
      cmd = cmdObj.cmd;
      onErrorCloseHandler = cmdObj.onErrorCloseHandler;
      additionalOpts = cmd.replace(originalCmd, '');
    }

    if (currentExecutionVariable) {
      if (cmd.includes(currentExecutionVariable)) {
        cmd = cmd.replace(new RegExp(`${currentExecutionVariable}=\\d+`, 'ig'), `${currentExecutionVariable}=${index}`);
      } else {
        cmd = `${currentExecutionVariable}=${index} ${cmd}`;
      }
    }
    const execProc = execute(cmd, executionHolder, execOpts, debugProcess);

    const killTooLongExecution = (procWhatShouldBeKilled) => {
      const executionTime = +Date.now() - startTime;
      if (executionTime > longestProcessTime) {
        if (debugProcess) {
          logger.info(`Process killed due to long time execution: ${millisecondsToMinutes(executionTime)}`);
        }
        procWhatShouldBeKilled.kill();
      }
    };

    const watcher = setInterval(() => killTooLongExecution(execProc), pollTime);

    execProc.on('exit', (code, signal) => {
      if (debugProcess) {
        logger.info(`EXIT PROCESS: PID="${execProc.pid}", code="${code}" and signal="${signal}"`);
      }
    });

    execProc.on('error', (e) => {
      if (debugProcess) {
        logger.info(`ERROR PROCESS: PID="${execProc.pid}"`);
      }
      logger.error(e);
    });

    execProc.on('close', async (code, signal) => {
      if (debugProcess) {
        logger.info(`CLOSE PROCESS: PID="${execProc.pid}", code="${code}" and signal="${signal}"`);
      }

      // clear watcher interval
      clearInterval(watcher);

      if (onErrorCloseHandler) {
        if (returnStringType(onErrorCloseHandler).includes('Function')) {
          await onErrorCloseHandler();
        }
      }

      // if process code 0 - exit as a success result
      if (code === successExitCode) {
        return resolve(null);
      }

      // processResultAnalyzer - check that stack contains or not contains some specific data
      if (processResultAnalyzer) {
        const countInNotRetriableBeforeAnalyzation = notRetriable.length;

        const processResultAnalyzerResultCommandOrNull = processResultAnalyzer(
          cmd,
          executionHolder.stackTrace,
          notRetriable
        );

        if (!processResultAnalyzerResultCommandOrNull && countInNotRetriableBeforeAnalyzation === notRetriable.length) {
          notRetriable.push(cmd);
        }
        return resolve(processResultAnalyzerResultCommandOrNull);
      }

      return resolve(cmd);
    })
  });
}

export {
  buildExecRunner
};
