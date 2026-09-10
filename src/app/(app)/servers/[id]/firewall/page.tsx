import {requireUser} from '@/lib/auth/guards';
import {getFirewallOverviewAction, listFirewallRulesAction} from '@/server/actions/firewall';
import {FirewallSection} from '@/components/servers/detail/firewall-section';

export default async function FirewallPage({params}: {params: Promise<{id: string}>}) {
  await requireUser();
  const {id} = await params;
  // Both at once: they are two calls to the same panel and the page needs both
  // before it can render anything useful.
  const [overview, rules] = await Promise.all([
    getFirewallOverviewAction(id),
    listFirewallRulesAction(id),
  ]);
  return <FirewallSection id={id} initialOverview={overview} initialRules={rules} />;
}
