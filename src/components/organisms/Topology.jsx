import {
  Lock,
  ScanFace,
  ArrowRight,
  Shield,
  BrainCircuit,
  Users,
  X,
  Info,
} from "lucide-react";
export function Topology() {
  return (
    <section className="panel topology-panel">
      <div className="panel-head">
        <h2>Isolation boundaries</h2>
        <Lock size={15} className="muted" />
      </div>
      <div className="topology">
        <div className="topology-node red-node">
          <span>
            <ScanFace size={25} />
          </span>
          <b>Red team</b>
          <small>
            Adversarial
            <br />
            test inputs
          </small>
        </div>
        <div className="topology-arrow">
          <ArrowRight size={21} />
        </div>
        <div className="topology-node gateway-node">
          <span>
            <Shield size={25} />
          </span>
          <b>Policy gateway</b>
          <small>
            Controlled
            <br />
            communication
          </small>
        </div>
        <div className="topology-arrow">
          <ArrowRight size={21} />
        </div>
        <div className="topology-node model-node">
          <span>
            <BrainCircuit size={25} />
          </span>
          <b>Client LLM</b>
          <small>
            Scoped model
            <br />
            adapter
          </small>
        </div>
        <div className="topology-arrow">
          <ArrowRight size={21} />
        </div>
        <div className="topology-node blue-node">
          <span>
            <Users size={25} />
          </span>
          <b>Blue team</b>
          <small>
            Defensive
            <br />
            policies
          </small>
        </div>
      </div>
      <div className="blocked-line">
        <span />
        <b>
          <X size={12} />
        </b>
        <span />
      </div>
      <div className="blocked-copy">
        <Lock size={11} />
        Direct access prohibited by design
      </div>
      <div className="topology-note">
        <Info size={13} />
        Demo topology · Not a security attestation
      </div>
    </section>
  );
}
