import { useState } from "react";
import { HealthFooter } from "./components/HealthFooter.tsx";
import { RepoList } from "./components/RepoList.tsx";
import { RepoScreen } from "./components/RepoScreen.tsx";
import { UsernameGate } from "./components/UsernameGate.tsx";
import { session } from "./session.ts";

// Three screens, no router: claim a username (decisions.md #13), pick
// a repo, work in it. Which one you see follows from two facts —
// who you are and which repo is open — both remembered in
// localStorage so a refresh puts you back where you were.
export function App() {
  const [username, setUsername] = useState<string | null>(() => session.getUsername());
  const [repoId, setRepoId] = useState<number | null>(() => session.getRepoId());

  let screen;
  if (username === null) {
    screen = (
      <UsernameGate
        onClaimed={(name) => {
          session.setUsername(name);
          setUsername(name);
        }}
      />
    );
  } else if (repoId === null) {
    screen = (
      <>
        <header className="topbar">
          <h1>Schema Version Control</h1>
          <div className="topbar-actions">
            <span className="user-chip" title="Your demo identity">
              {username}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                session.clear();
                setUsername(null);
                setRepoId(null);
              }}
            >
              Switch user
            </button>
          </div>
        </header>
        <RepoList
          username={username}
          onOpen={(id) => {
            session.setRepoId(id);
            setRepoId(id);
          }}
        />
      </>
    );
  } else {
    screen = (
      <RepoScreen
        key={repoId}
        username={username}
        repoId={repoId}
        onLeaveRepo={() => {
          session.setRepoId(null);
          setRepoId(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      {screen}
      <HealthFooter />
    </div>
  );
}
