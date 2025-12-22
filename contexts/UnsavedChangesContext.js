import React, { createContext, useContext, useState } from 'react';

const UnsavedChangesContext = createContext();

export function UnsavedChangesProvider({ children }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  return (
    <UnsavedChangesContext.Provider value={{ hasUnsavedChanges, setHasUnsavedChanges }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    return { hasUnsavedChanges: false, setHasUnsavedChanges: () => {} };
  }
  return context;
}

