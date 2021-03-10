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

/** True values in YAML 1.2 Core Schema. */
const YAML_TRUE_VALUES = Object.freeze(['true', 'True', 'TRUE']);
/** False values in YAML 1.2 Core Schema. */
const YAML_FALSE_VALUES = Object.freeze(['false', 'False', 'FALSE']);

const workspacePath = core.getInput('workspace-path');

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

/**
 * Returns the boolean value of the specified input.
 *
 * TODO(actions/toolkit#723): Remove this once there's an equivalent method in
 * core.
 */
function getInputBool(name) {
  const inputStr = core.getInput(name);
  if (YAML_TRUE_VALUES.includes(inputStr)) {
    return true;
  }
  if (YAML_FALSE_VALUES.includes(inputStr)) {
    return false;
  }

  throw new TypeError(
      `${inputStr} is not a valid YAML 1.2 Core Schema boolean`);
}

module.exports = {
  workspacePath: workspacePath,
  execBash: execBash,
  getInputBool: getInputBool,
};