import { useState } from 'react';
import type { ToolActivity } from '../src/protocol';

/**
 * What the assistant did to the workspace.
 *
 * Shown for the same reason a citation is shown: an answer derived from four
 * files the developer never saw it open is indistinguishable from a guess. This
 * makes the difference visible without turning the panel into a log — one line
 * per call, naming the file, and nothing else until something needs attention.
 *
 * A proposed write is the exception. It is the one thing here that has not
 * happened yet, so it gets the room to say so and the buttons to decide it.
 *
 * A subgraph query is the other. Naming its target the way a file read names
 * its path says almost nothing — "uniswap-v3 · mainnet" is not evidence — so it
 * carries the GraphQL it ran, one click away. Collapsed by default, because the
 * developer asked about a price and not about a query; available, because a
 * live number in an answer is only worth more than a guess if it can be
 * checked.
 */

const VERB: Record<string, string> = {
  read_file: 'Read',
  list_directory: 'Listed',
  search_files: 'Searched',
  write_file: 'Edit',
  query_blockchain: 'Queried',
};

const STATUS_ICON: Record<ToolActivity['status'], string> = {
  running: '◴',
  error: '✕',
  rejected: '⊘',
  applied: '✎',
  done: '✓',
  'awaiting-approval': '◴',
};

/**
 * One finished or running call.
 *
 * Split out from the trail because a row that can expand needs state, and the
 * trail must not re-render every row when one of them opens.
 */
function ToolLine({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(activity.query);

  const head = (
    <>
      <span className="tool-icon" aria-hidden="true">
        {STATUS_ICON[activity.status]}
      </span>
      <span className="tool-verb">{VERB[activity.name] ?? activity.name}</span>
      <span className="tool-target" title={activity.summary}>
        {activity.summary}
      </span>
      {activity.detail && activity.status !== 'error' && (
        <span className="tool-diffstat">{activity.detail}</span>
      )}
      {activity.status === 'error' && (
        <span className="tool-error" title={activity.detail}>
          {activity.detail}
        </span>
      )}
      {expandable && (
        <span className={`tool-expand${open ? ' open' : ''}`} aria-hidden="true">
          ›
        </span>
      )}
    </>
  );

  if (!expandable) {
    return <div className={`tool-line ${activity.status}`}>{head}</div>;
  }

  return (
    <div className="tool-group">
      <button
        className={`tool-line expandable ${activity.status}`}
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        title={open ? 'Hide the query' : 'Show the query that was run'}
      >
        {head}
      </button>
      {open && <pre className="tool-query">{activity.query?.trim()}</pre>}
    </div>
  );
}

interface Props {
  activities: ToolActivity[];
  onApprove: (toolUseId: string) => void;
  onReject: (toolUseId: string) => void;
  onReview: (toolUseId: string) => void;
}

export function ToolTrail({ activities, onApprove, onReject, onReview }: Props) {
  if (activities.length === 0) return null;

  // A scaffold proposes several files at once. Deciding them one at a time is
  // the difference between reviewing a change and clicking through a wizard, so
  // the group gets a single control once there is more than one.
  const awaiting = activities.filter((a) => a.status === 'awaiting-approval');

  return (
    <div className="tool-trail">
      {activities.map((activity) =>
        activity.status === 'awaiting-approval' ? (
          <div className="tool-approval" key={activity.id}>
            <div className="tool-approval-head">
              <span className="tool-approval-title">Proposed change</span>
              <span className="tool-diffstat">{activity.detail}</span>
            </div>

            <div className="tool-approval-path">{activity.summary}</div>

            <div className="tool-approval-actions">
              <button className="ghost" onClick={() => onReview(activity.id)}>
                Review diff
              </button>
              <span className="spacer" />
              <button className="ghost" onClick={() => onReject(activity.id)}>
                Discard
              </button>
              <button className="primary small" onClick={() => onApprove(activity.id)}>
                Apply
              </button>
            </div>
          </div>
        ) : (
          <ToolLine activity={activity} key={activity.id} />
        ),
      )}

      {awaiting.length > 1 && (
        <div className="tool-approval-all">
          <span className="tool-approval-all-count">
            {awaiting.length} files proposed
          </span>
          <button className="ghost" onClick={() => awaiting.forEach((a) => onReject(a.id))}>
            Discard all
          </button>
          <button
            className="primary small"
            onClick={() => awaiting.forEach((a) => onApprove(a.id))}
          >
            Apply all {awaiting.length}
          </button>
        </div>
      )}
    </div>
  );
}
