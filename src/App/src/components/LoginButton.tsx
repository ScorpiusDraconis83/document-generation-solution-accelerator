import React from 'react';
import {
  Avatar,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import { SignOut20Regular } from '@fluentui/react-icons';
import { useAuth } from '../contexts/AuthContext';

/**
 * AvatarTrigger — forwardRef wrapper so Fluent UI MenuTrigger can attach its ref and click handlers.
 */
const AvatarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { userName: string }
>(({ userName, ...props }, ref) => (
  <button
    ref={ref}
    {...props}
    style={{
      background: 'none',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
    }}
  >
    <Avatar name={userName} color="colorful" size={36} />
  </button>
));
AvatarTrigger.displayName = 'AvatarTrigger';

const LoginButton: React.FC = () => {
  const { isAuthenticated, user, logout } = useAuth();

  if (!isAuthenticated || !user) {
    const displayName = user?.userName || user?.userEmail || 'User';
    return (
      <Avatar
        name={displayName}
        color="colorful"
        size={36}
      />
    );
  }

  const displayName = user.userName || user.userEmail || 'User';

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <AvatarTrigger userName={displayName} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<SignOut20Regular />} onClick={logout}>
            Sign out
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};

export default LoginButton;
