import React from 'react';
import './Toggle.css';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  title?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, className = '', title }) => {
  return (
    <button
      type="button"
      className={`simple-toggle ${checked ? 'checked' : ''} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      title={title}
      role="switch"
      aria-checked={checked}
    >
      <span className="simple-toggle-knob" />
    </button>
  );
};
