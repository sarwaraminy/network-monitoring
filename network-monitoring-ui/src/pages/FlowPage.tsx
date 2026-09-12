import FlowStatusPanel from '../components/FlowStatusPanel';

/**
 * The Flow collection page, and the only place the collector's state is shown.
 *
 * A thin wrapper over `FlowStatusPanel`, kept as a page of its own rather than
 * folded into the administration gear: this is what an operator reads while
 * watching the network, and most of them are not administrators. Configuring the
 * collector is the other half and lives under the gear — see `admin/FlowSettings`,
 * which reads the status endpoint for its retry and renders none of it.
 *
 * See `FlowStatusPanel` for what the panel is built around.
 */
export default function FlowPage() {
  return <FlowStatusPanel />;
}
