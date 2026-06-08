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
  const family_id = url.searchParams.get('family_id')
  const date = url.searchParams.get('date')

  if (!family_id || !date) return json({ error: 'Missing family_id or date' }, 400)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const [familyRes, membersRes] = await Promise.all([
    sb.from('families').select('*').eq('id', family_id).single(),
    sb.from('family_members').select('*').eq('family_id', family_id).order('joined_at'),
  ])

  if (familyRes.error || !familyRes.data) return json({ error: 'Family not found' }, 404)

  const family  = familyRes.data
  const members = membersRes.data ?? []

  const memberSummaries = await Promise.all(
    members.map(async (m) => {
      if (!m.user_id) {
        return {
          member_id: m.id, display_name: m.display_name, avatar_emoji: m.avatar_emoji,
          role: m.role, calorie_goal: m.calorie_goal ?? 2000, has_account: false,
          calories: 0, proteines: 0, glucides: 0, lipides: 0,
          water_ml: 0, water_glasses: 0, activity_calories_burned: 0, net_calories: 0,
        }
      }

      const [mealsRes, waterRes, actRes] = await Promise.all([
        sb.from('meals').select('calories, proteines, glucides, lipides').eq('user_id', m.user_id).eq('date', date),
        sb.from('water_logs').select('amount_ml').eq('user_id', m.user_id).eq('date', date),
        sb.from('activities').select('calories_burned').eq('user_id', m.user_id).eq('date', date),
      ])

      const dayMeals = mealsRes.data ?? []
      const water_ml = (waterRes.data ?? []).reduce((s, r) => s + r.amount_ml, 0)
      const activity_calories_burned = (actRes.data ?? []).reduce((s, a) => s + a.calories_burned, 0)
      const calories = dayMeals.reduce((s, r) => s + (r.calories ?? 0), 0)

      return {
        member_id: m.id, display_name: m.display_name, avatar_emoji: m.avatar_emoji,
        role: m.role, calorie_goal: m.calorie_goal ?? 2000, has_account: true,
        calories,
        proteines: dayMeals.reduce((s, r) => s + (r.proteines ?? 0), 0),
        glucides:  dayMeals.reduce((s, r) => s + (r.glucides  ?? 0), 0),
        lipides:   dayMeals.reduce((s, r) => s + (r.lipides   ?? 0), 0),
        water_ml, water_glasses: Math.round(water_ml / 250),
        activity_calories_burned,
        net_calories: calories - activity_calories_burned,
      }
    })
  )

  return json({
    family_id, family_name: family.name, invite_code: family.invite_code,
    date, member_count: members.length,
    members: memberSummaries,
    family_totals: {
      calories:   memberSummaries.reduce((s, m) => s + m.calories,   0),
      proteines:  memberSummaries.reduce((s, m) => s + m.proteines,  0),
      glucides:   memberSummaries.reduce((s, m) => s + m.glucides,   0),
      lipides:    memberSummaries.reduce((s, m) => s + m.lipides,    0),
      water_ml:   memberSummaries.reduce((s, m) => s + m.water_ml,   0),
      activity_calories_burned: memberSummaries.reduce((s, m) => s + m.activity_calories_burned, 0),
    },
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
