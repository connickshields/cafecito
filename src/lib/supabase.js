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

// Submit an order
export async function submitOrder(userId, customerName, orderItems) {
  // Start a Supabase transaction
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      customer_name: customerName,
      status: 'pending'
    })
    .select()
    .single();

  if (orderError) throw orderError;

  const orderId = order.id;

  for (const item of orderItems) {
    // Insert order item
    const { data: orderItem, error: orderItemError } = await supabase
      .from('order_items')
      .insert({
        order_id: orderId,
        item_id: item.itemId, // Use itemId instead of id
        milk_option_id: item.milkOption?.id,
        quantity: item.quantity
      })
      .select()
      .single();

    if (orderItemError) throw orderItemError;

    // Insert customizations if any
    if (item.customizations && item.customizations.length > 0) {
      const customizationsToInsert = item.customizations.map(customization => ({
        order_item_id: orderItem.id,
        customization_option_id: customization.id
      }));

      const { error: customizationError } = await supabase
        .from('order_item_customizations')
        .insert(customizationsToInsert);

      if (customizationError) throw customizationError;
    }
  }

  return { orderId: orderId };
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

// Count how many active orders (pending or in_progress) are ahead of the given order
export async function getOrdersAheadCount(orderId) {
  // Fetch the target order's created_at
  const { data: target, error: targetError } = await supabase
    .from('orders')
    .select('id, created_at, status')
    .eq('id', orderId)
    .single();

  if (targetError) throw targetError;

  // If the order is completed/cancelled, there are no orders ahead
  if (target.status === 'completed' || target.status === 'cancelled') {
    return 0;
  }

  // Count orders created before this one that are still active
  const { data: ahead, error: aheadError } = await supabase
    .from('orders')
    .select('id')
    .in('status', ['pending', 'in_progress'])
    .lt('created_at', target.created_at);

  if (aheadError) throw aheadError;

  return (ahead || []).length;
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