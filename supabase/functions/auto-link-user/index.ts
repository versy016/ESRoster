/**
 * Supabase Edge Function: Auto-link User to Surveyor
 * 
 * This function automatically links a newly created user to a surveyor profile
 * if their email addresses match. It should be called after user signup.
 * 
 * Usage:
 *   const { data, error } = await supabase.functions.invoke('auto-link-user', {
 *     body: { userId: 'user-uuid', userEmail: 'user@example.com' }
 *   });
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Get Supabase client with service role for admin access
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing Supabase environment variables')
        }

        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // Get userId and userEmail from request body
        const { userId, userEmail } = await req.json()

        if (!userId || !userEmail) {
            return new Response(
                JSON.stringify({ error: 'userId and userEmail are required' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(userEmail.trim())) {
            return new Response(
                JSON.stringify({ error: 'Invalid email format' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // Call the database function to auto-link user to surveyor
        const { data, error } = await supabaseClient.rpc('auto_link_user_to_surveyor', {
            p_user_id: userId,
            p_user_email: userEmail.trim()
        })

        if (error) {
            console.error('Error calling auto_link_user_to_surveyor:', error)
            return new Response(
                JSON.stringify({
                    error: 'Failed to auto-link user to surveyor',
                    details: error.message
                }),
                {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // Check the result from the database function
        if (!data || !data.success) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: data?.error || 'Auto-link failed',
                    details: data
                }),
                {
                    status: 200, // Still 200 since function executed successfully
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // Success
        return new Response(
            JSON.stringify({
                success: true,
                message: data.message || 'User successfully linked to surveyor',
                surveyorId: data.surveyor_id,
                surveyorName: data.surveyor_name,
                alreadyLinked: data.already_linked || false
            }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )

    } catch (error) {
        console.error('Edge Function error:', error)
        return new Response(
            JSON.stringify({
                error: error.message || 'Internal server error',
                details: error.stack
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )
    }
})

