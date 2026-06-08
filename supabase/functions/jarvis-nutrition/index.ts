import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nutritrack-key',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.headers.get('x-nutritrack-key') !== Deno.env.get('NUTRITRACK_JARVIS_KEY')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(req.url)
  const member_id = url.searchParams.get('member_id')
  const date = url.searchParams.get('date')

  if (!member_id || !date) return json({ error: 'Missing member_id or date' }, 400)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: member, error: memberErr } = await sb
    .from('family_members').select('*').eq('id', member_id).single()

  if (memberErr || !member) return json({ error: 'Member not found' }, 404)

  const user_id = member.user_id

  if (!user_id) {
    return json({
      member_id, member_name: member.display_name, avatar: member.avatar_emoji,
      date, meals: [],
      totals: { calories: 0, proteines: 0, glucides: 0, lipides: 0, fibres: 0 },
      water_ml: 0, water_glasses: 0, activities: [], activity_calories_burned: 0,
      calorie_goal: member.calorie_goal ?? 2000, net_calories: 0,
    })
  }

  const [mealsRes, waterRes, actRes] = await Promise.all([
    sb.from('meals').select('*').eq('user_id', user_id).eq('date', date).order('created_at'),
    sb.from('water_logs').select('amount_ml').eq('user_id', user_id).eq('date', date),
    sb.from('activities').select('*').eq('user_id', user_id).eq('date', date),
  ])

  const meals = mealsRes.data ?? []
  const water_ml = (waterRes.data ?? []).reduce((s, r) => s + r.amount_ml, 0)
  const activities = actRes.data ?? []

  const totals = {
    calories:  meals.reduce((s, m) => s + (m.calories  ?? 0), 0),
    proteines: meals.reduce((s, m) => s + (m.proteines ?? 0), 0),
    glucides:  meals.reduce((s, m) => s + (m.glucides  ?? 0), 0),
    lipides:   meals.reduce((s, m) => s + (m.lipides   ?? 0), 0),
    fibres:    meals.reduce((s, m) => s + (m.fibres    ?? 0), 0),
  }
  const activity_calories_burned = activities.reduce((s, a) => s + (a.calories_burned ?? 0), 0)

  return json({
    member_id, member_name: member.display_name, avatar: member.avatar_emoji,
    date, meals, totals,
    water_ml, water_glasses: Math.round(water_ml / 250),
    activities, activity_calories_burned,
    calorie_goal: member.calorie_goal ?? 2000,
    net_calories: totals.calories - activity_calories_burned,
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
