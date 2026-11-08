/**
 * ALTERNATE deployable main module for the existing owner Knowledge Worker.
 *
 * Default HTTP behavior is exactly the existing Access-protected Worker.
 * The named RPC entrypoint is inaccessible through public URL routes and
 * can only be bound by an explicitly configured same-account Worker service.
 * Production currently uses src/worker-cloudflare-private.mjs, NOT this file.
 */
import {WorkerEntrypoint} from 'cloudflare:workers';
import ownerWorker,{handlePrivateMergeCapture} from './worker-cloudflare-private.mjs';

export class KnowledgeCaptureEntrypoint extends WorkerEntrypoint {
  async saveMergeReceipt(payload) {
    return handlePrivateMergeCapture(this.env,payload);
  }
}
export default ownerWorker;
