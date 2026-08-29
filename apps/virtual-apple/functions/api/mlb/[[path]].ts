import { proxyMlbRequest, type MlbProxyContext } from "../../../src/mlbEdgeProxy";

export function onRequest(context: MlbProxyContext) {
  return proxyMlbRequest(context);
}
