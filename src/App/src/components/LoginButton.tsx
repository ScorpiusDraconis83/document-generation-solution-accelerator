import React from 'react';
import {
  Avatar,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Button,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { SignOut24Regular } from '@fluentui/react-icons';
import { useAuth } from '../contexts/AuthContext';

const useStyles = makeStyles({
  userButton: {
    minWidth: 'auto',
    paddingLeft: tokens.spacingHorizontalXS,
    paddingRight: tokens.spacingHorizontalXS,
  },
  menuItem: {
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: tokens.spacingVerticalXXS,
  },
  userName: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
  },
  userEmail: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
  },
});

const getUserInitials = (name: string | undefined): string => {
  if (!name) return 'U';
  const cleanName = name.replace(/\s*\([^)]*\)/g, '').trim();
  const parts = cleanName.split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return cleanName.charAt(0).toUpperCase();
};

const LoginButton: React.FC = () => {
  const styles = useStyles();
  const { isAuthenticated, user, logout } = useAuth();

  const displayName = user?.userName || user?.userEmail || 'User';
  const userEmail = user?.userEmail || '';

  if (!isAuthenticated || !user) {
    return (
      <Avatar
        name={displayName}
        initials={getUserInitials(displayName)}
        size={28}
        color="colorful"
        style={{ fontWeight: 'bold' }}
      />
    );
  }

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={`Signed in as ${displayName}`} relationship="label">
          <Button
            appearance="subtle"
            className={styles.userButton}
            icon={
              <Avatar
                name={displayName}
                initials={getUserInitials(displayName)}
                size={28}
                color="colorful"
                style={{ fontWeight: 'bold' }}
              />
            }
          />
        </Tooltip>
      </MenuTrigger>

      <MenuPopover>
        <MenuList>
          <MenuItem className={styles.menuItem} disabled>
            <div className={styles.userInfo}>
              <div className={styles.userName}>{displayName}</div>
              {userEmail && <div className={styles.userEmail}>{userEmail}</div>}
            </div>
          </MenuItem>
          <MenuItem
            className={styles.menuItem}
            icon={<SignOut24Regular />}
            onClick={logout}
          >
            Sign out
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};

export default LoginButton;
