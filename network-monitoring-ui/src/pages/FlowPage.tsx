import FlowStatusPanel from '../components/FlowStatusPanel';

/**
 * The Flow collection page.
 *
 * A thin wrapper, because the panel has two homes. This one is the navigation
 * entry an operator uses while watching the network; the administration gear
 * opens the same component embedded, next to the query console's diagnostics,
 * for whoever is setting flow up — at which point it is a configuration question
 * rather than a monitoring one.
 *
 * One component and not two views over one endpoint. See `FlowStatusPanel` for what
 * the panel is built around, and `AdminSettingsMenu` for the same argument about
 * the delivery form.
 */
export default function FlowPage() {
  return <FlowStatusPanel />;
}
