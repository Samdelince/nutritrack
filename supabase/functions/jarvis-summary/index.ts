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
  const days = Math.min(parseInt(url.searchParams.get('days') ?? '7'), 90)

  if (!member_id) return json({ error: 'Missing member_id' }, 400)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: member, error: memberErr } = await sb
    .from('family_members').select('*').eq('id', member_id).single()

  if (memberErr || !member) return json({ error: 'Member not found' }, 404)

  const user_id = member.user_id
  const today = new Date().toISOString().split('T')[0]
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

  const [mealsRes, waterRes, weightsRes, actRes] = await Promise.all([
    sb.from('meals').select('date, calories, proteines, glucides, lipides, fibres')
      .eq('user_id', user_id).gte('date', since).lte('date', today),
    sb.from('water_logs').select('date, amount_ml')
      .eq('user_id', user_id).gte('date', since).lte('date', today),
    sb.from('weights').select('date, weight_kg')
      .eq('user_id', user_id).order('date', { ascending: false }).limit(30),
    sb.from('activities').select('date, calories_burned')
      .eq('user_id', user_id).gte('date', since).lte('date', today),
  ])

  const meals      = mealsRes.data   ?? []
  const water      = waterRes.data   ?? []
  const weights    = weightsRes.data ?? []
  const activities = actRes.data     ?? []

  // Build per-day stats for the full period
  const dayArr: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    dayArr.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0])
  }

  const daily = dayArr.map(d => {
    const dm = meals.filter(m => m.date === d)
    const dw = water.filter(w => w.date === d).reduce((s, r) => s + r.amount_ml, 0)
    const da = activities.filter(a => a.date === d).reduce((s, a) => s + a.calories_burned, 0)
    return {
      date: d,
      calories:  dm.reduce((s, m) => s + (m.calories  ?? 0), 0),
      proteines: dm.reduce((s, m) => s + (m.proteines ?? 0), 0),
      glucides:  dm.reduce((s, m) => s + (m.glucides  ?? 0), 0),
      lipides:   dm.reduce((s, m) => s + (m.lipides   ?? 0), 0),
      fibres:    dm.reduce((s, m) => s + (m.fibres    ?? 0), 0),
      water_ml: dw,
      activity_calories_burned: da,
    }
  })

  // Averages only over days that have at least some data
  const active = daily.filter(d => d.calories > 0 || d.water_ml > 0)
  const n = active.length || 1
  const avg = (key: keyof typeof active[0]) =>
    Math.round((active as any[]).reduce((s, d) => s + d[key], 0) / n)

  return json({
    member_id, member_name: member.display_name, avatar: member.avatar_emoji,
    calorie_goal: member.calorie_goal ?? 2000,
    period_days: days, days_with_data: active.length, since, until: today,
    averages: {
      calories:  avg('calories'),
      proteines: avg('proteines'),
      glucides:  avg('glucides'),
      lipides:   avg('lipides'),
      fibres:    avg('fibres'),
      water_ml:  avg('water_ml'),
      water_glasses: Math.round(avg('water_ml') / 250),
      activity_calories_burned: avg('activity_calories_burned'),
    },
    latest_weight_kg: weights[0]?.weight_kg ?? null,
    weight_trend: weights.slice(0, 7).reverse().map(w => ({ date: w.date, weight_kg: w.weight_kg })),
    daily_breakdown: daily,
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
