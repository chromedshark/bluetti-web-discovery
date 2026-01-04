import { type ReactNode } from "react";
import { Router, Route, Switch, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { createKeyBundle } from "./encryption/key-bundle";
import { DeviceProvider, useDevice } from "./context/DeviceContext";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";

declare module "bun" {
  interface Env {
    KEY_BUNDLE_SIGNING_KEY: string;
    KEY_BUNDLE_VERIFY_KEY: string;
    KEY_BUNDLE_SHARED_SECRET: string;
  }
}

window.bluettiKeyBundle = await createKeyBundle(
  process.env.KEY_BUNDLE_SIGNING_KEY,
  process.env.KEY_BUNDLE_VERIFY_KEY,
  process.env.KEY_BUNDLE_SHARED_SECRET
);

// Route guard: redirects to connect if no device
function RequireDevice({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [, navigate] = useHashLocation();

  if (!device) {
    navigate("/");
    return null;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <DeviceProvider>
      <Router hook={useHashLocation}>
        <Switch>
          <Route path="/" component={ConnectPage} />

          <Route path="/dashboard">
            <RequireDevice>
              <DashboardPage />
            </RequireDevice>
          </Route>

          <Route path="/discovery">
            <RequireDevice>
              <DiscoveryPage />
            </RequireDevice>
          </Route>

          {/* Fallback */}
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </Router>
    </DeviceProvider>
  );
}
