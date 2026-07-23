"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, CheckCircle2, AlertCircle, User as UserIcon, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export default function AccountEditor({
  userId,
  email,
  initialDisplayName,
  initialAvatarUrl,
}: {
  userId: string;
  email: string;
  initialDisplayName: string;
  initialAvatarUrl: string | null;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialAvatarUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        nextAvatarUrl = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
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
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-editor" aria-labelledby="account-title">
      <div className="intro">
        <h1 id="account-title">My Account</h1>
        <p className="muted">Update your name and photo.</p>
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
    </section>
  );
}
