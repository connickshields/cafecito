/// <reference types="svelte" />
/// <reference types="vite/client" />

export type MenuItem = {
    id: number;
    name: string;
    description: string;
    available: boolean;
    allows_milk_choice: boolean;
    allows_customizations: boolean;
};
  
export type OrderItem = {
    tempId: number; // Use this for client-side identification
    itemId: number; // This should match the id from the items table
    name: string;
    quantity: number;
    milkOption?: {
        id: number;
        name: string;
    };
    customizations?: {
        id: number;
        name: string;
    }[];
};

export type OrderDetails = {
    id: number;
    status: string;
    items: {
      name: string;
      quantity: number;
      milkOption: string | null;
      customizations: string[];
    }[];
};

export type Order = {
    id: number;
    status: string;
    customerName: string;
    created_at: string;
    updated_at: string;
    items: {
      name: string;
      quantity: number;
      milkOption: string | null;
      customizations: string[];
      completedInstances: boolean[];
    }[];
};