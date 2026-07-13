/*
 * Copyright 2026 Cody Park
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useState } from 'react';
import icon from './assets/icon.png';

export default function UpdaterView() {
  const [status, setStatus] = useState({ phase: 'checking' });

  useEffect(() => {
    return window.api.onUpdaterStatus((s) => setStatus(s));
  }, []);

  return (
    <div className="updater-root">
      <img className="updater-icon" src={icon} alt="" />
      <h1 className="updater-title">Disco</h1>
      <p className="updater-text">
        {status.phase === 'checking' ? 'Checking for updates\u2026' : `Downloading update v${status.version}\u2026`}
      </p>
      {status.phase === 'downloading' && (
        <div className="updater-progress">
          <div className="updater-progress-fill" style={{ width: `${status.percent ?? 0}%` }} />
        </div>
      )}
    </div>
  );
}
