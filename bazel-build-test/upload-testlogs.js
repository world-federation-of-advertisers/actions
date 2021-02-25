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

const artifact = require('@actions/artifact');
const core = require('@actions/core');
const fs = require('fs');
const glob = require('@actions/glob');

const {execBash, workspacePath} = require('./common');

async function findFiles(dir) {
  const files = [];
  const globber = await glob.create(dir);
  for await (const path of globber.globGenerator()) {
    const stats = await fs.promises.stat(path);
    if (!stats.isDirectory()) {
      files.push(path);
    }
  }

  return files;
}

async function run() {
  const testlogsPath = await execBash(['bazelisk info bazel-testlogs']);
  const files = await findFiles(testlogsPath);
  if (files.length === 0) {
    core.info('No test logs found; skipping upload');
    return;
  }

  const artifactClient = artifact.create();
  await artifactClient.uploadArtifact('bazel-testlogs', files, testlogsPath);
}

(async function() {
  try {
    await run();
  } catch (err) {
    core.setFailed(err);
  }
}());
