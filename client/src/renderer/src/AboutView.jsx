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

const INVITE_URL =
  'https://discord.com/oauth2/authorize?client_id=1521967083632591030&permissions=3146752&integration_type=0&scope=applications.commands+bot';

export default function AboutView({ onBack }) {
  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <div className="settings-topbar-inner about-topbar-inner">
          <button className="settings-back-btn" onClick={onBack}>
            ‹ Back
          </button>
          <h2 className="settings-title">About</h2>
        </div>
      </div>
      <div className="settings-scroll about-scroll">
        <div className="about-card">
          <h3 className="settings-heading">Adding Disco to your server</h3>
          <section className="settings-section">
            <p>
              To use Disco, someone with permission to add bots needs to invite it to your Discord
              server once. Open the link below in a browser and pick your server:
            </p>
            <label className="settings-field">
              Invite link
              <input readOnly value={INVITE_URL} onClick={(e) => e.target.select()} />
            </label>
          </section>
        </div>

        <div className="about-card">
          <h3 className="settings-heading">The join and leave commands</h3>
          <section className="settings-section">
            <p>Once Disco is in your server, you control it with two slash commands, typed in any text channel:</p>
            <ul>
              <li>
                <code>/disco join</code> - makes Disco join the voice channel you're currently in and
                start speech to text.
              </li>
              <li>
                <code>/disco leave</code> - makes Disco leave that voice channel and stop.
              </li>
            </ul>
          </section>
        </div>

        <div className="about-card">
          <h3 className="settings-heading">Disco only stays while you do</h3>
          <section className="settings-section">
            <p>
              Disco always joins the voice channel <em>you</em> are in when you run{' '}
              <code>/disco join</code> - it can't be sent into a channel you're not in yourself.
            </p>
            <p>
              Disco also leaves automatically if you leave. For example: you join a voice channel, run{' '}
              <code>/disco join</code>, and later leave that channel - Disco leaves too, right away,
              even if you didn't run <code>/disco leave</code>.
            </p>
          </section>
        </div>

        <div className="about-card">
          <h3 className="settings-heading">Signing in and seeing speech to text</h3>
          <section className="settings-section">
            <p>
              To see speech to text in this app, you sign in with your Discord account using "Login to
              Discord" on the main page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
