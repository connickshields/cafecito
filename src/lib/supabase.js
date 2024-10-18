import { createClient } from '@supabase/supabase-js'
import { writable } from 'svelte/store'

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
  if (error) throw error;
  userSession.set(null);
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
export async function getMenuItems() {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('available', true)
    .order('name')
  
  if (error) throw error
  return data
}

// Retrieve milk options
export async function getMilkOptions() {
  const { data, error } = await supabase
    .from('milk_options')
    .select('*')
    .eq('available', true)
    .order('name')
  
  if (error) throw error
  return data
}

// Retrieve customization options
export async function getCustomizationOptions() {
  const { data, error } = await supabase
    .from('customization_options')
    .select('*')
    .eq('available', true)
    .order('name')
  
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
      customizations: item.order_item_customizations.map(c => c.customization_options.name)
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