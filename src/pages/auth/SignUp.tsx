import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, User, Mail, Lock } from "lucide-react";
import { getSupabase } from "../../lib/supabase";

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const getPasswordStrength = (pw: string): { label: string; width: string; color: string } => {
    if (pw.length === 0) return { label: "", width: "0%", color: "bg-gray-200" };
    if (pw.length < 6) return { label: "Weak", width: "25%", color: "bg-red-400" };
    if (pw.length < 10) return { label: "Fair", width: "50%", color: "bg-amber-400" };
    if (/(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/.test(pw))
      return { label: "Strong", width: "100%", color: "bg-green" };
    return { label: "Good", width: "75%", color: "bg-blue" };
  };

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    const { error: signUpError } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
    } else {
      setSuccess(true);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Link>

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Create Account</h2>
        <p className="mt-1.5 text-sm text-gray-500">
          Create an account to get started.
        </p>
      </div>

      {success ? (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          Account created! Check your email to confirm, then sign in.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}

          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          <div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="auth-input"
                required
              />
            </div>
            {password.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all ${strength.color}`}
                    style={{ width: strength.width }}
                  />
                </div>
                <span className="text-[11px] text-gray-400">{strength.label}</span>
              </div>
            )}
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          <button type="submit" className="auth-btn-primary" disabled={submitting}>
            {submitting ? "Creating..." : "Create Account"}
          </button>
        </form>
      )}

      <p className="text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link to="/signin" className="font-medium text-blue hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
