/**
 * Deliberately separate from knowledge-forward-backup-private.
 * No HTTP route, cron schedule, root key or normal Knowledge write binding.
 * Provisioning this Workflow requires a separate reviewed release.
 */
import {WorkflowEntrypoint} from 'cloudflare:workers';
import {runConsistentD1Export} from './forward-consistent-export.mjs';

export class KnowledgeConsistentD1ExportWorkflow extends WorkflowEntrypoint {
  async run(_event,step) {
    return runConsistentD1Export({env:this.env,step});
  }
}
export default {
  async fetch() {
    return new Response(null,{status:404,headers:{
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    }});
  },
};
