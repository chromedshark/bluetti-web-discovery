import { useEffect, type ReactNode } from "react";
import { Router, Route, Switch, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { createKeyBundle } from "./encryption/key-bundle";
import { BluetoothClient } from "./bluetooth/client";
import { DeviceProvider, useDevice } from "./context/DeviceContext";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";
import { LoadingSpinner } from "./components/LoadingSpinner";

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

// Dev-only test route that bypasses protocol detection
// URL format: #/test/connect?protocolVersion=1001&deviceType=TEST
function TestConnectRoute() {
  const { setDevice } = useDevice();
  const [, navigate] = useHashLocation();

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.hash.split("?")[1]);
      const protocolVersion = parseInt(params.get("protocolVersion")!, 10);
      const deviceType = params.get("deviceType")!;

      const client = await BluetoothClient.request(window.bluettiKeyBundle);
      await client.connect();

      setDevice({ client, protocolVersion, deviceType });
      navigate("/dashboard");
    })();
  }, [setDevice, navigate]);

  return (
    <div className="page">
      <LoadingSpinner />
    </div>
  );
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

          {process.env.NODE_ENV === "development" && (
            <Route path={/^\/test\/connect/} component={TestConnectRoute} />
          )}

          {/* Fallback */}
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </Router>
    </DeviceProvider>
  );
}
