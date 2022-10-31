/**
 * Copyright 2021 The Cross-Media Measurement Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const core = require('@actions/core');
const exec = require('@actions/exec');

const workspacePath = core.getInput('workspace-path');
const buildOptions = core.getMultilineInput('build-options');

async function execBash(commands) {
  const command = commands.join('\n');
  const lines = [];
  await exec.exec('bash', ['-c', command], {
    cwd: workspacePath,
    listeners: {
      stdline: (line) => {
        lines.push(line);
      }
    }
  });
  return lines.join('\n');
}

module.exports = {
  buildOptions: buildOptions,
  workspacePath: workspacePath,
  execBash: execBash,
};