"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, CheckCircle2, AlertCircle, User as UserIcon, Mail, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export default function AccountEditor({
  userId,
  email,
  initialDisplayName,
  initialAvatarUrl,
  initialPhone,
}: {
  userId: string;
  email: string;
  initialDisplayName: string;
  initialAvatarUrl: string | null;
  initialPhone: string;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialAvatarUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mobile / phone state
  const [phone, setPhone] = useState(initialPhone);
  const [phoneError, setPhoneError] = useState("");
  const [phoneWarning, setPhoneWarning] = useState("");
  const [phoneChecking, setPhoneChecking] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const phoneSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    if (phoneSavedTimerRef.current) clearTimeout(phoneSavedTimerRef.current);
  }, []);

  function pickAvatar() {
    fileInputRef.current?.click();
  }

  function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Image must be under 5 MB.");
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    const supabase = createClient();
    const trimmedName = displayName.trim();

    try {
      let nextAvatarUrl = avatarUrl;

      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${userId}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(AVATAR_BUCKET)
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
        if (uploadError) throw new Error(uploadError.message);
        const publicUrl = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
        nextAvatarUrl = `${publicUrl}?v=${Date.now()}`;
      }

      // Keep both sources in sync: Auth metadata drives the navbar (read
      // client-side from the session), customer_profiles drives admin's
      // customer list — same split the register route already keeps in sync.
      const { error: authError } = await supabase.auth.updateUser({
        data: { display_name: trimmedName || null, avatar_url: nextAvatarUrl },
      });
      if (authError) throw new Error(authError.message);

      const { error: profileError } = await supabase
        .from("customer_profiles")
        .update({ display_name: trimmedName || null, avatar_url: nextAvatarUrl })
        .eq("id", userId);
      if (profileError) throw new Error(profileError.message);

      setAvatarUrl(nextAvatarUrl);
      setAvatarFile(null);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  // --- Phone helpers ---

  function validatePhoneFormat(value: string): string {
    if (!value.trim()) return "Phone number is required";
    if (!/^[+\d][\d\s\-().]{6,19}$/.test(value.trim())) return "Enter a valid phone number";
    return "";
  }

  /** Check for duplicates on blur — only if the number actually changed. */
  async function handlePhoneBlur() {
    const trimmed = phone.trim();
    if (trimmed === initialPhone) {
      setPhoneWarning("");
      setPhoneError("");
      return;
    }
    const fmt = validatePhoneFormat(trimmed);
    if (fmt) {
      setPhoneError(fmt);
      setPhoneWarning("");
      return;
    }
    setPhoneError("");
    setPhoneChecking(true);
    setPhoneWarning("");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmed, checkOnly: true }),
      });
      if (res.status === 409) {
        const data = await res.json();
        setPhoneWarning(data.error ?? "This number is already registered.");
      }
    } catch {
      // network error — silently ignore; server will catch it on save
    } finally {
      setPhoneChecking(false);
    }
  }

  async function handlePhoneSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = phone.trim();
    const fmt = validatePhoneFormat(trimmed);
    if (fmt) {
      setPhoneError(fmt);
      return;
    }
    setPhoneError("");
    setPhoneSaving(true);
    setPhoneWarning("");
    setPhoneSaved(false);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setPhoneWarning(data.error ?? "This number is already registered.");
        } else {
          setPhoneError(data.error ?? "Unable to save phone number.");
        }
        return;
      }
      setPhoneSaved(true);
      if (phoneSavedTimerRef.current) clearTimeout(phoneSavedTimerRef.current);
      phoneSavedTimerRef.current = setTimeout(() => setPhoneSaved(false), 3000);
    } catch {
      setPhoneError("Network error. Please try again.");
    } finally {
      setPhoneSaving(false);
    }
  }

  const phoneUnchanged = phone.trim() === initialPhone;

  return (
    <section className="account-editor" aria-labelledby="account-title">
      <div className="intro">
        <h1 id="account-title">My Account</h1>
        <p className="muted">Update your name, photo and mobile number.</p>
      </div>

      <form className="account-form" onSubmit={handleSave}>
        <div className="account-avatar-row">
          <button
            type="button"
            className="account-avatar-picker"
            onClick={pickAvatar}
            aria-label="Change profile photo"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="" className="account-avatar-img" />
            ) : (
              <span className="account-avatar-placeholder">
                <UserIcon size={28} aria-hidden="true" />
              </span>
            )}
            <span className="account-avatar-edit-badge" aria-hidden="true">
              <Camera size={14} />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onAvatarChange}
            style={{ display: "none" }}
          />
          <div>
            <span className="account-avatar-label">Profile photo</span>
            <button type="button" className="account-avatar-change-link" onClick={pickAvatar}>
              {avatarPreview ? "Change photo" : "Add photo"}
            </button>
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="account-name">Name</label>
          <div className="input-wrapper">
            <span className="input-icon">
              <UserIcon size={18} strokeWidth={2} />
            </span>
            <input
              id="account-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              disabled={saving}
            />
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="account-email">Email</label>
          <div className="input-wrapper">
            <span className="input-icon">
              <Mail size={18} strokeWidth={2} />
            </span>
            <input id="account-email" type="email" value={email} disabled readOnly />
          </div>
        </div>

        {error && (
          <div className="login-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {saved && (
          <div className="login-notice" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Profile updated.</span>
          </div>
        )}

        <button type="submit" className="login-btn" disabled={saving}>
          {saving ? (
            <>
              <Loader2 size={18} className="spin" />
              Saving...
            </>
          ) : (
            <span>Save changes</span>
          )}
        </button>
      </form>

      {/* ── Mobile number — separate save ─────────── */}
      <form className="account-form" onSubmit={handlePhoneSave} style={{ marginTop: "8px" }}>
        <div className="input-group">
          <label htmlFor="account-phone">Mobile number</label>
          <div className="input-wrapper" style={{ position: "relative" }}>
            <span className="input-icon">
              <Phone size={18} strokeWidth={2} />
            </span>
            <input
              id="account-phone"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError("");
                setPhoneWarning("");
              }}
              onBlur={handlePhoneBlur}
              placeholder="+91 98765 43210"
              autoComplete="tel"
              disabled={phoneSaving}
              aria-describedby={
                phoneError ? "phone-error" : phoneWarning ? "phone-warning" : undefined
              }
            />
            {phoneChecking && (
              <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                <Loader2 size={15} className="spin" />
              </span>
            )}
          </div>
        </div>

        {phoneError && (
          <div className="login-error" role="alert" id="phone-error">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{phoneError}</span>
          </div>
        )}

        {phoneWarning && (
          <div
            className="login-error"
            role="alert"
            id="phone-warning"
            style={{
              background: "#fffbeb",
              borderColor: "#d97706",
              color: "#92400e",
            }}
          >
            <AlertCircle size={16} aria-hidden="true" />
            <span>{phoneWarning}</span>
          </div>
        )}

        {phoneSaved && (
          <div className="login-notice" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Mobile number updated.</span>
          </div>
        )}

        <button
          type="submit"
          className="login-btn"
          disabled={phoneSaving || phoneUnchanged || !!phoneWarning}
          style={{ opacity: phoneUnchanged ? 0.5 : 1 }}
        >
          {phoneSaving ? (
            <>
              <Loader2 size={18} className="spin" />
              Saving...
            </>
          ) : (
            <span>Update mobile</span>
          )}
        </button>
      </form>
    </section>
  );
}
