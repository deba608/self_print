"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, CreditCard, Printer, RotateCcw, X } from "lucide-react";

type Detail = {
  job: {
    id: string;
    token: string;
    status: string;
    printType: string;
    copies: number;
    pageRange: string | null;
    paperSize: string;
    pageCount: number;
    pricePaise: number;
    needsConversion: 0 | 1;
    createdAt: string;
  };
  file: { id: string; originalName: string; mimeType: string; fileKind: string; sizeBytes: number };
  events: Array<{ id: string; event_type: string; message: string; created_at: string }>;
};

export default function JobDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch(`/api/admin/jobs/${id}`);
    if (!response.ok) {
      setError("Unable to load job");
      return;
    }
    setDetail(await response.json());
  }

  useEffect(() => {
    load();
  }, [id]);

  async function setStatus(status: string) {
    setError("");
    const response = await fetch(`/api/admin/jobs/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Action failed");
    await load();
  }

  async function reprint() {
    const response = await fetch(`/api/admin/jobs/${id}/reprint`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Reprint failed");
    await load();
  }

  if (!detail) {
    return <main className="shell"><p>{error || "Loading..."}</p></main>;
  }

  const { job, file } = detail;
  const previewUrl = `/api/uploads/${file.id}`;

  return (
    <main className="shell stack">
      <div className="row between">
        <div>
          <Link className="muted" href="/admin">Back to queue</Link>
          <h1>Token {job.token}</h1>
          <span className="badge">{job.needsConversion ? "needs conversion" : job.status}</span>
        </div>
        <strong className="price">₹{(job.pricePaise / 100).toFixed(2)}</strong>
      </div>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <section className="grid admin-grid">
        <div className="panel stack">
          <h2>Job Details</h2>
          <table>
            <tbody>
              <tr><th>File</th><td>{file.originalName}</td></tr>
              <tr><th>Pages</th><td>{job.pageCount || "Needs conversion"}</td></tr>
              <tr><th>Type</th><td>{job.printType === "bw" ? "Black & white" : "Color"}</td></tr>
              <tr><th>Copies</th><td>{job.copies}</td></tr>
              <tr><th>Range</th><td>{job.pageRange || "All"}</td></tr>
              <tr><th>Paper</th><td>{job.paperSize}</td></tr>
              <tr><th>Uploaded</th><td>{new Date(job.createdAt).toLocaleString()}</td></tr>
            </tbody>
          </table>
          <div className="stack">
            <button onClick={() => setStatus("paid")}><CreditCard size={16} /> Mark paid</button>
            <button onClick={() => setStatus("approved")}><Printer size={16} /> Approve / release</button>
            <button className="secondary" onClick={() => setStatus("printed")}><Check size={16} /> Mark printed</button>
            <button className="secondary" onClick={reprint}><RotateCcw size={16} /> Reprint</button>
            <button className="danger" onClick={() => setStatus("cancelled")}><X size={16} /> Cancel</button>
          </div>
        </div>
        <div className="panel stack">
          <h2>Preview</h2>
          {file.fileKind === "pdf" ? <iframe className="preview" src={previewUrl} /> : null}
          {file.fileKind === "image" ? <img className="preview" src={previewUrl} alt={file.originalName} /> : null}
          {file.fileKind === "document" ? <p className="muted">DOC/DOCX files are stored only in this MVP. Convert to PDF before release.</p> : null}
          <h3>Events</h3>
          <div className="stack">
            {detail.events.map((event) => (
              <div className="card" style={{ padding: 10 }} key={event.id}>
                <strong>{event.event_type}</strong>
                <p className="muted" style={{ marginBottom: 0 }}>{event.message} · {new Date(event.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
