import { useState } from "react";
import { HealthFooter } from "./components/HealthFooter.tsx";
import { RepoList } from "./components/RepoList.tsx";
import { RepoScreen } from "./components/RepoScreen.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { UserMenu } from "./components/UserMenu.tsx";
import { UsernameGate } from "./components/UsernameGate.tsx";
import { session } from "./session.ts";

// Three screens, no router: claim a username (decisions.md #13), pick
// a repo, work in it. Which one you see follows from two facts —
// who you are and which repo is open — both remembered in
// localStorage so a refresh puts you back where you were.
export function App() {
  const [username, setUsername] = useState<string | null>(() => session.getUsername());
  const [repoId, setRepoId] = useState<number | null>(() => session.getRepoId());

  // Dropping the identity drops the open repo with it, so the next
  // person lands on their own repo list rather than someone else's
  // work. Passed down to RepoScreen too — switching user is reachable
  // from inside a repo, behind that screen's unsaved-changes guard.
  function switchUser() {
    session.clear();
    setUsername(null);
    setRepoId(null);
  }

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
          <h1>
            <span className="topbar-gem" aria-hidden="true" />
            Schema Version Control
          </h1>
          <div className="topbar-actions">
            <ThemeToggle />
            <UserMenu username={username} onGoToRepos={null} onSwitchUser={switchUser} />
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
        onSwitchUser={switchUser}
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
