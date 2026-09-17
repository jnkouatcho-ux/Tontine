// Tontine data edge function
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNthSundayOfMonth(year: number, month: number, weekNumber: number): Date | null {
  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = firstDay.getDay();
  const firstSunday = 1 + ((7 - firstDayOfWeek) % 7);
  if (weekNumber === 5) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const lastDayDate = new Date(year, month, lastDay);
    const lastDayOfWeek = lastDayDate.getDay();
    const offset = lastDayOfWeek % 7;
    return new Date(year, month, lastDay - offset);
  }
  const targetSunday = firstSunday + (weekNumber - 1) * 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (targetSunday > lastDay) return null;
  return new Date(year, month, targetSunday);
}

function generateScheduleDates(
  startDate: string,
  endDate: string,
  periodicityType: string,
  periodicityDetail: Record<string, number>
): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  if (periodicityType === "monthly") {
    const weekNumber = periodicityDetail.weekNumber;
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      const nth = getNthSundayOfMonth(current.getFullYear(), current.getMonth(), weekNumber);
      if (nth && nth >= start && nth <= end) dates.push(toLocalDateStr(nth));
      current.setMonth(current.getMonth() + 1);
    }
  } else if (periodicityType === "weekly") {
    const dayOfWeek = periodicityDetail.dayOfWeek;
    const current = new Date(start);
    while (current.getDay() !== dayOfWeek) current.setDate(current.getDate() + 1);
    while (current <= end) { dates.push(toLocalDateStr(current)); current.setDate(current.getDate() + 7); }
  } else if (periodicityType === "biweekly") {
    const dayOfWeek = periodicityDetail.dayOfWeek;
    const current = new Date(start);
    while (current.getDay() !== dayOfWeek) current.setDate(current.getDate() + 1);
    while (current <= end) { dates.push(toLocalDateStr(current)); current.setDate(current.getDate() + 14); }
  }

  return dates;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "my-tontines") {
      const { data: memberships, error: memberErr } = await serviceClient
        .from("tontine_members")
        .select("tontine_id, role, eating_order, tontines(id, name, start_date, end_date, periodicity_type, periodicity_detail, contribution_amount, eating_amount, transferred_cash, status, created_by)")
        .eq("user_id", user.id);

      if (memberErr) {
        return new Response(JSON.stringify({ error: memberErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tontines = (memberships || []).map((m: any) => ({
        ...m.tontines,
        role: m.role,
        eating_order: m.eating_order,
        member_id: m.tontine_id,
      }));

      return new Response(JSON.stringify({ tontines }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "tontine-data") {
      const tontineId = url.searchParams.get("tontine_id");
      if (!tontineId) {
        return new Response(JSON.stringify({ error: "Missing tontine_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: membership } = await serviceClient
        .from("tontine_members")
        .select("role")
        .eq("tontine_id", tontineId)
        .eq("user_id", user.id)
        .maybeSingle();

      // Also check if user is the creator
      const { data: tontineCheck } = await serviceClient
        .from("tontines")
        .select("created_by")
        .eq("id", tontineId)
        .maybeSingle();

      const isCreator = tontineCheck?.created_by === user.id;
      const role = membership?.role || (isCreator ? "admin" : null);

      if (!membership && !isCreator) {
        return new Response(JSON.stringify({ error: "Not a member" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [tontineRes, membersRes, categoriesRes, contributionsRes, scheduleRes, loansRes, payoutsRes, invitationsRes, withdrawalsRes, interestDistRes] = await Promise.all([
        serviceClient.from("tontines").select("*").eq("id", tontineId).maybeSingle(),
        serviceClient.from("tontine_members").select("*, profile:profiles(*)").eq("tontine_id", tontineId).order("eating_order"),
        serviceClient.from("categories").select("*").eq("tontine_id", tontineId).order("created_at"),
        serviceClient.from("contributions").select("*, category:categories(*), member:tontine_members(profile:profiles(*))").eq("tontine_id", tontineId).order("paid_at", { ascending: false }),
        serviceClient.from("eating_schedule").select("*").eq("tontine_id", tontineId).order("order_number"),
        serviceClient.from("loans").select("*, loan_sources(*)").eq("tontine_id", tontineId).order("created_at", { ascending: false }),
        serviceClient.from("payouts").select("*").eq("tontine_id", tontineId),
        serviceClient.from("tontine_invitations").select("*").eq("tontine_id", tontineId).order("created_at", { ascending: false }),
        serviceClient.from("cash_withdrawals").select("*").eq("tontine_id", tontineId),
        serviceClient.from("interest_distributions").select("*").eq("tontine_id", tontineId),
      ]);

      let enrichedSchedule = scheduleRes.data || [];
      if (enrichedSchedule.length > 0) {
        const userIds = [...new Set(enrichedSchedule.map((s: any) => s.user_id))];
        const { data: profiles } = await serviceClient
          .from("profiles")
          .select("*")
          .in("id", userIds);
        const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
        enrichedSchedule = enrichedSchedule.map((s: any) => ({
          ...s,
          profile: profileMap[s.user_id] || null,
        }));
      }

      let enrichedContributions = contributionsRes.data || [];
      enrichedContributions = enrichedContributions.map((c: any) => ({
        ...c,
        profile: c.member?.profile || null,
      }));

      let enrichedLoans = loansRes.data || [];
      if (enrichedLoans.length > 0) {
        const memberIds = [...new Set(enrichedLoans.map((l: any) => l.member_id))];
        const { data: loanMembers } = await serviceClient
          .from("tontine_members")
          .select("id, profile:profiles(*)")
          .in("id", memberIds);
        const memberMap = Object.fromEntries((loanMembers || []).map((m: any) => [m.id, m.profile]));
        enrichedLoans = enrichedLoans.map((l: any) => ({
          ...l,
          profile: memberMap[l.member_id] || null,
        }));
      }

      return new Response(JSON.stringify({
        tontine: tontineRes.data,
        members: membersRes.data,
        categories: categoriesRes.data,
        contributions: enrichedContributions,
        schedule: enrichedSchedule,
        loans: enrichedLoans,
        payouts: payoutsRes.data,
        invitations: invitationsRes.data,
        withdrawals: withdrawalsRes.data || [],
        interestDistributions: interestDistRes.data || [],
        role,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "search-users") {
      const query = url.searchParams.get("q");
      if (!query || query.length < 2) {
        return new Response(JSON.stringify({ users: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: users, error: searchErr } = await serviceClient
        .from("profiles")
        .select("id, username, first_name, last_name, email")
        .or(`username.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .neq("id", user.id)
        .limit(10);

      if (searchErr) {
        return new Response(JSON.stringify({ error: searchErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ users: users || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "pending-invitations") {
      const { data: invitations, error: invErr } = await serviceClient
        .from("tontine_invitations")
        .select("*, tontine:tontines(*)")
        .eq("invitee_user_id", user.id)
        .eq("status", "pending");

      if (invErr) {
        return new Response(JSON.stringify({ error: invErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ count: invitations?.length || 0, invitations }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "accept-invitation") {
      const invitationId = url.searchParams.get("invitation_id");
      if (!invitationId) {
        return new Response(JSON.stringify({ error: "Missing invitation_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 1. Verify the invitation belongs to this user and is pending
      const { data: invitation, error: invErr } = await serviceClient
        .from("tontine_invitations")
        .select("*")
        .eq("id", invitationId)
        .eq("invitee_user_id", user.id)
        .eq("status", "pending")
        .maybeSingle();

      if (invErr || !invitation) {
        return new Response(JSON.stringify({ error: "Invitation not found or already processed" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2. Check if already a member
      const { data: existingMember } = await serviceClient
        .from("tontine_members")
        .select("id")
        .eq("tontine_id", invitation.tontine_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingMember) {
        // Already a member, just update invitation
        await serviceClient
          .from("tontine_invitations")
          .update({ status: "accepted" })
          .eq("id", invitationId);
        return new Response(JSON.stringify({ success: true, message: "Already a member" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 3. Use eating_order from the invitation (set at creation time).
      //    Fall back to max+1 only if the invitation doesn't carry one.
      const invitedEatingOrder = (invitation as any).eating_order as number | null;

      let nextEatingOrder: number;
      let nextScheduleOrder: number;

      if (invitedEatingOrder != null) {
        nextEatingOrder = invitedEatingOrder;
        nextScheduleOrder = invitedEatingOrder;
      } else {
        const { data: currentMembers } = await serviceClient
          .from("tontine_members")
          .select("eating_order")
          .eq("tontine_id", invitation.tontine_id)
          .order("eating_order", { ascending: false })
          .limit(1);
        nextEatingOrder = (currentMembers?.[0]?.eating_order || 0) + 1;

        const { data: currentSchedule } = await serviceClient
          .from("eating_schedule")
          .select("order_number, scheduled_date")
          .eq("tontine_id", invitation.tontine_id)
          .order("order_number", { ascending: false })
          .limit(1);
        nextScheduleOrder = (currentSchedule?.[0]?.order_number || 0) + 1;
      }

      // 5. Get tontine info for date calculation
      const { data: tontine } = await serviceClient
        .from("tontines")
        .select("start_date, end_date, periodicity_type, periodicity_detail")
        .eq("id", invitation.tontine_id)
        .maybeSingle();

      // Calculate the correct scheduled date using the periodicity algorithm
      let scheduledDateStr = new Date().toISOString().split("T")[0];
      if (tontine?.start_date && tontine?.end_date) {
        const tourDates = generateScheduleDates(
          tontine.start_date,
          tontine.end_date,
          tontine.periodicity_type,
          tontine.periodicity_detail
        );
        const idx = nextScheduleOrder - 1;
        if (idx >= 0 && idx < tourDates.length) {
          scheduledDateStr = tourDates[idx];
        }
      }

      // 6. Add member
      const { data: newMember, error: memberErr } = await serviceClient
        .from("tontine_members")
        .insert({
          tontine_id: invitation.tontine_id,
          user_id: user.id,
          role: "member",
          eating_order: nextEatingOrder,
        })
        .select()
        .single();

      if (memberErr) {
        return new Response(JSON.stringify({ error: "Failed to add member: " + memberErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 7. Create eating schedule entry
      await serviceClient.from("eating_schedule").insert({
        tontine_id: invitation.tontine_id,
        member_id: newMember.id,
        user_id: user.id,
        order_number: nextScheduleOrder,
        scheduled_date: scheduledDateStr,
        status: "pending",
      });

      // 7b. Create initial contributions for this member based on invitation's initial_amounts
      const initialAmounts = (invitation as any).initial_amounts || {};
      const categoryIds = Object.keys(initialAmounts).filter((id: string) => Number(initialAmounts[id]) > 0);

      if (categoryIds.length > 0) {
        const today = new Date().toISOString().split("T")[0];
        const initialContribs = categoryIds.map((catId: string) => ({
          tontine_id: invitation.tontine_id,
          member_id: newMember.id,
          category_id: catId,
          amount: Number(initialAmounts[catId]),
          period_date: today,
          recorded_by: invitation.inviter_id,
        }));
        await serviceClient.from("contributions").insert(initialContribs);
      }

      // 8. Update invitation status
      await serviceClient
        .from("tontine_invitations")
        .update({ status: "accepted" })
        .eq("id", invitationId);

      return new Response(JSON.stringify({ success: true, tontine_id: invitation.tontine_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reject-invitation") {
      const invitationId = url.searchParams.get("invitation_id");
      if (!invitationId) {
        return new Response(JSON.stringify({ error: "Missing invitation_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await serviceClient
        .from("tontine_invitations")
        .update({ status: "rejected" })
        .eq("id", invitationId)
        .eq("invitee_user_id", user.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "my-invitations") {
      const { data: invitations, error: invErr } = await serviceClient
        .from("tontine_invitations")
        .select("*, tontine:tontines(id, name)")
        .eq("invitee_user_id", user.id)
        .order("created_at", { ascending: false });

      if (invErr) {
        return new Response(JSON.stringify({ error: invErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ invitations: invitations || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

