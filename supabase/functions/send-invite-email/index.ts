import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

  try {
    const { to, inviteeName, inviterName, projectName, role, appUrl, isNewUser } = await req.json();

    const roleLabel = role?.replace(/_/g, " ") ?? "member";

    const html = isNewUser ? `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #f8fafc;">
        <div style="background: #1e293b; border-radius: 12px; padding: 32px; color: #f1f5f9;">
          <h1 style="color: #0095da; margin: 0 0 8px;">AG&amp;E QC Checklist</h1>
          <hr style="border: none; border-top: 1px solid #334155; margin: 16px 0;" />
          <p style="font-size: 16px; margin: 0 0 16px;">Hi there,</p>
          <p style="margin: 0 0 16px;"><strong>${inviterName}</strong> invited you to join the project <strong>"${projectName}"</strong> as <strong>${roleLabel}</strong> on AG&amp;E QC Checklist.</p>
          <p style="margin: 0 0 20px; color: #94a3b8;">Click the button below to create your account. Once you sign up, you'll automatically be added to the project.</p>
          <a href="${appUrl}" style="display: inline-block; padding: 12px 24px; background: #0095da; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 0 0 16px;">
            Accept Invitation &amp; Sign Up →
          </a>
          <p style="color: #64748b; font-size: 12px; margin: 24px 0 0;">This invitation link expires in 30 days. Register using this email address to be added to the project automatically.</p>
        </div>
      </div>` : `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #f8fafc;">
        <div style="background: #1e293b; border-radius: 12px; padding: 32px; color: #f1f5f9;">
          <h1 style="color: #0095da; margin: 0 0 8px;">AG&amp;E QC Checklist</h1>
          <hr style="border: none; border-top: 1px solid #334155; margin: 16px 0;" />
          <p style="font-size: 16px; margin: 0 0 16px;">Hi ${inviteeName ?? "there"},</p>
          <p style="margin: 0 0 16px;"><strong>${inviterName}</strong> added you to the project <strong>"${projectName}"</strong> as <strong>${roleLabel}</strong>.</p>
          <a href="${appUrl}" style="display: inline-block; padding: 12px 24px; background: #0095da; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0;">
            Open QC Checklist →
          </a>
          <p style="color: #64748b; font-size: 12px; margin: 24px 0 0;">You'll also see a notification in the app when you next sign in.</p>
        </div>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "AG&E QC Checklist <onboarding@resend.dev>",
        to: [to],
        subject: `You've been added to "${projectName}" on AG&E QC Checklist`,
        html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.ok ? 200 : 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
