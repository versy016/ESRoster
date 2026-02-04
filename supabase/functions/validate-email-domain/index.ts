/**
 * Supabase Edge Function: Validate Email Domain
 * 
 * This function validates that an email address belongs to an allowed domain
 * before allowing user signup. It should be called before the signup process.
 * 
 * Usage:
 *   const { data, error } = await supabase.functions.invoke('validate-email-domain', {
 *     body: { email: 'user@example.com' }
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

        // Get email from request body
        const { email } = await req.json()

        if (!email || typeof email !== 'string') {
            return new Response(
                JSON.stringify({ error: 'Email is required' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email.trim())) {
            return new Response(
                JSON.stringify({ error: 'Invalid email format' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // Check if domain is allowed using the database function
        const { data: isAllowed, error: domainError } = await supabaseClient.rpc('is_email_domain_allowed', {
            email_address: email.trim()
        })

        if (domainError) {
            console.error('Error checking domain:', domainError)
            return new Response(
                JSON.stringify({ error: 'Failed to validate email domain', details: domainError.message }),
                {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // If domain is not allowed, get allowed domains for error message
        if (!isAllowed) {
            const { data: allowedDomains } = await supabaseClient.rpc('get_allowed_email_domains')
            const domainList = allowedDomains && allowedDomains.length > 0
                ? allowedDomains.join(', ')
                : 'none configured'

            return new Response(
                JSON.stringify({
                    error: `Email domain is not allowed. Allowed domains: ${domainList}`,
                    allowed: false
                }),
                {
                    status: 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            )
        }

        // Domain is allowed
        return new Response(
            JSON.stringify({
                success: true,
                message: 'Email domain is allowed',
                allowed: true
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

