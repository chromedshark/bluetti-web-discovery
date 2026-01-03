import type { Draft } from "immer";
import { useImmerReducer } from "use-immer";
import { createKeyBundle } from "./encryption/key-bundle";
import type { BluetoothClient } from "./bluetooth/client";
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

export interface DeviceInfo {
  client: BluetoothClient;
  protocolVersion: number;
  deviceType: string | null;
}

export type AppAction =
  | { type: "navigate"; to: "dashboard" | "discovery" }
  | { type: "connectionSuccess"; device: DeviceInfo }
  | { type: "disconnect" };

export type ViewState = { type: "connect" } | { type: "dashboard" } | { type: "discovery" };

interface AppState {
  view: ViewState;
  device: DeviceInfo | null;
}

const initialState: AppState = {
  view: { type: "connect" },
  device: null,
};

function reducer(draft: Draft<AppState>, action: AppAction) {
  switch (action.type) {
    case "navigate":
      draft.view = { type: action.to };
      break;

    case "connectionSuccess":
      draft.device = action.device;
      draft.view = { type: "dashboard" };
      break;

    case "disconnect":
      if (draft.device) {
        draft.device.client.disconnect();
        draft.device = null;
      }
      draft.view = { type: "connect" };
      break;

    default: {
      const _action: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(_action)}`);
    }
  }
}

export default function App() {
  const [state, dispatch] = useImmerReducer(reducer, initialState);

  switch (state.view.type) {
    case "connect":
      return <ConnectPage dispatch={dispatch} />;

    case "dashboard":
      return <DashboardPage device={state.device!} dispatch={dispatch} />;

    case "discovery":
      return <DiscoveryPage dispatch={dispatch} />;

    default: {
      const _view: never = state.view;
      throw new Error(`Unknown view: ${JSON.stringify(_view)}`);
    }
  }
}
