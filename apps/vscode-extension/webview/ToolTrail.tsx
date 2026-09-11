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
 */

const VERB: Record<string, string> = {
  read_file: 'Read',
  list_directory: 'Listed',
  search_files: 'Searched',
  write_file: 'Edit',
};

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
          <div className={`tool-line ${activity.status}`} key={activity.id}>
            <span className="tool-icon" aria-hidden="true">
              {activity.status === 'running'
                ? '◴'
                : activity.status === 'error'
                  ? '✕'
                  : activity.status === 'rejected'
                    ? '⊘'
                    : activity.status === 'applied'
                      ? '✎'
                      : '✓'}
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
          </div>
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
