import { metrics } from "../utils/metrics.js";

export async function getSessionReport() {
  return metrics.getSummary();
}
