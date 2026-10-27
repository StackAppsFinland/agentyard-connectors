// Public API for agentyard-connectors.

export { JsonRpcPeer, JsonRpcError, type JsonRpcPeerOptions, type JsonRpcErrorObject } from "./acp/JsonRpcPeer.js";
export { AcpClient, type SessionUpdateListener, type PermissionResponder } from "./acp/AcpClient.js";
export { AcpProcess, type AcpProcessOptions, type SpawnFn } from "./acp/AcpProcess.js";
export * as acp from "./acp/messages.js";

export { DevinBinaryLocator, DevinBinaryNotFoundError, type DevinBinaryLocatorOptions } from "./devin/DevinBinaryLocator.js";
export { DevinConnector, type DevinConnectorOptions, type IAcpClient } from "./devin/DevinConnector.js";
export {
  buildTranscript,
  contentBlockText,
  type TranscriptEntry,
  type TranscriptEntryKind,
  type TranscriptToolCall,
} from "./devin/transcript.js";

export {
  DevinConnectorError,
  type ConnectorCapabilities,
  type PermissionHandler,
  type PermissionRequest,
  type TabEvent,
  type TabInfo,
  type TabTranscript,
} from "./connector/types.js";
