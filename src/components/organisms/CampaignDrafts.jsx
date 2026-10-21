import { api } from "../../lib/api.js";
import { FilePenLine, Archive } from "lucide-react";
export function CampaignDrafts({ drafts, resumeDraft, act, busy }) {
  return (
    <section className="panel campaign-drafts">
      <div className="panel-heading">
        <div>
          <h2>
            Saved drafts <span className="subtle">({drafts.length})</span>
          </h2>
          <p className="subtle">
            Prepare configurations now. Launch when you are ready.
          </p>
        </div>
      </div>
      {!drafts.length ? (
        <p className="draft-empty">
          Choose New campaign → Save draft to prepare an evaluation without
          starting it.
        </p>
      ) : (
        <div className="draft-list">
          {drafts.map((d) => (
            <article className="draft-row" key={d.id}>
              <FilePenLine size={20} aria-hidden="true" />
              <div className="draft-info">
                <strong>{d.name}</strong>
                <p className="subtle">
                  {d.mode === "synthetic-demo" ? "Synthetic fixtures" : d.model}{" "}
                  · Revision {d.version}
                  {d.parentId ? " · Cloned campaign" : ""}
                </p>
              </div>
              <div className="inline">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => resumeDraft(d)}
                >
                  Resume draft
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Archive draft ${d.name}`}
                  disabled={busy}
                  onClick={() =>
                    act(() =>
                      api(`/drafts/${d.id}/archive`, { version: d.version }),
                    )
                  }
                >
                  <Archive size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
