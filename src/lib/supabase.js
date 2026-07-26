import { createClient } from '@supabase/supabase-js'
import { writable } from 'svelte/store'

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'cafecito-auth'
  }
})

// Create a store for the user session
export const userSession = writable(null)

// Initialize the session on app load
supabase.auth.getSession().then(({ data: { session } }) => {
  userSession.set(session)
})

// Listen for auth changes
supabase.auth.onAuthStateChange((event, session) => {
  userSession.set(session)
})

// Sign in anonymously
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  userSession.set(null);
  if (error) throw error;
}

// Regular sign in (for baristas)
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw error
  return data
}

// Check if the user is a barista
export function isBaristaUser(user) {
  return user && !user.is_anonymous
}

// Retrieve menu items
export async function getMenuItems(includeUnavailable = false) {
  let query = supabase
    .from('items')
    .select('*')
    .order('name')
    
  if (!includeUnavailable) {
    query = query.eq('available', true)
  }

  const { data, error } = await query
  
  if (error) throw error
  return data
}

// Retrieve milk options
export async function getMilkOptions(includeUnavailable = false) {
  let query =  supabase
    .from('milk_options')
    .select('*')
    .order('name')

  if (!includeUnavailable) {
    query = query.eq('available', true)
  }
  
  const { data, error } = await query
  if (error) throw error
  return data
}

// Retrieve customization options
export async function getCustomizationOptions(includeUnavailable = false) {
  let query = supabase
    .from('customization_options')
    .select('*')
    .order('name')
  
  if (!includeUnavailable) {
    query = query.eq('available', true)
  }
  
  const { data, error } = await query
  
  if (error) throw error
  return data
}

// Submit an order atomically via the create_order RPC
export async function submitOrder(customerName, orderItems) {
  const items = orderItems.map((item) => ({
    item_id: item.itemId,
    milk_option_id: item.milkOption?.id ?? null,
    quantity: item.quantity,
    customization_option_ids: (item.customizations ?? []).map((c) => c.id),
  }))

  const { data, error } = await supabase.rpc('create_order', {
    p_customer_name: customerName,
    p_items: items,
  })

  if (error) throw error
  return { orderId: data }
}

export async function cancelOrder(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', orderId)
    .eq('status', 'pending');

  if (error) throw error;
  return data;
}

export async function getOrderDetails(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      status,
      created_at,
      customer_name,
      order_items (
        id,
        quantity,
        items (name),
        milk_options (name),
        order_item_customizations (
          customization_options (name)
        )
      )
    `)
    .eq('id', orderId)
    .single();

  if (error) throw error;

  return {
    id: data.id,
    status: data.status,
    createdAt: data.created_at,
    customerName: data.customer_name,
    items: data.order_items.map(item => ({
      name: item.items.name,
      quantity: item.quantity,
      milkOption: item.milk_options ? item.milk_options.name : null,
      customizations: item.order_item_customizations.map(c => c.customization_options.name)
    }))
  };
}

export async function getOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      status,
      customer_name,
      created_at,
      updated_at,
      order_items (
        id,
        quantity,
        items (name),
        milk_options (name),
        order_item_customizations (
          customization_options (name)
        )
      )
    `)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return data.map(order => ({
    id: order.id,
    status: order.status,
    customerName: order.customer_name,
    created_at: order.created_at,
    updated_at: order.updated_at,
    items: order.order_items.map(item => ({
      name: item.items.name,
      quantity: item.quantity,
      milkOption: item.milk_options ? item.milk_options.name : null,
      customizations: item.order_item_customizations.map(c => c.customization_options.name),
      completedInstances: new Array(item.quantity).fill(false)
    }))
  }));
}

export async function updateOrderStatus(orderId, newStatus) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: newStatus })
    .eq('id', orderId);

  if (error) throw error;
  return data;
}

// New functions to update availability
export async function updateMilkAvailability(milkId, available) {
  const { data, error } = await supabase
    .from('milk_options')
    .update({ available })
    .eq('id', milkId);
  
  if (error) throw error;
  return data;
}

// Aggregate queue numbers (drinks ahead, active orders, recent drain rate).
// Without orderId: the whole active queue, for the pre-order banner.
export async function getQueueStats(orderId = null) {
  const { data, error } = await supabase.rpc('get_queue_stats', { p_order_id: orderId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    drinksAhead: row?.drinks_ahead ?? 0,
    activeOrders: row?.active_orders ?? 0,
    estMinsPerDrink: row?.est_mins_per_drink == null ? null : Number(row.est_mins_per_drink),
  }
}

// The current session's own active order, if any (own-orders RLS applies)
export async function getActiveOrder() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_name, status')
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function updateItemAvailability(itemId, available) {
  const { data, error } = await supabase
    .from('items')
    .update({ available })
    .eq('id', itemId);
  
  if (error) throw error;
  return data;
}

export async function updateCustomizationAvailability(customizationId, available) {
  const { data, error } = await supabase
    .from('customization_options')
    .update({ available })
    .eq('id', customizationId);
  
  if (error) throw error;
  return data;
}