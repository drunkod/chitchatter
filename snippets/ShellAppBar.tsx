// Target: src/components/Shell/ShellAppBar.tsx
//
// Minimal-mode app bar: renders nothing when `minimalUi.hideAppBar` is set.
// Since the drawer and peer list are only ever opened from the app bar
// buttons, hiding the bar hides them too — no changes needed in Shell.tsx.
// The styled `AppBar` export is preserved because Shell.tsx imports it.

import { styled } from '@mui/material/styles'
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar'

import { minimalUi } from 'config/minimalMode'

import { drawerWidth } from './Drawer'
import { peerListWidth } from './PeerList'

interface AppBarProps extends MuiAppBarProps {
  isDrawerOpen?: boolean
  isPeerListOpen?: boolean
}

export const AppBar = styled(MuiAppBar, {
  shouldForwardProp: prop =>
    prop !== 'isDrawerOpen' && prop !== 'isPeerListOpen',
})<AppBarProps>(({ theme, isDrawerOpen, isPeerListOpen }) => ({
  transition: theme.transitions.create(['margin', 'width'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(isDrawerOpen && {
    width: `calc(100% - ${drawerWidth}px)`,
    marginLeft: `${drawerWidth}px`,
  }),
  ...(isPeerListOpen && {
    width: `calc(100% - ${peerListWidth}px)`,
    marginRight: `${peerListWidth}px`,
  }),
  ...((isDrawerOpen || isPeerListOpen) && {
    transition: theme.transitions.create(['margin', 'width'], {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
  ...(isDrawerOpen &&
    isPeerListOpen && {
      width: `calc(100% - ${drawerWidth}px - ${peerListWidth}px)`,
    }),
}))

// Same props interface as the original so Shell.tsx compiles unchanged.
interface ShellAppBarProps {
  onDrawerOpen: () => void
  onLinkButtonClick: () => Promise<void>
  isDrawerOpen: boolean
  isPeerListOpen: boolean
  title: string
  onPeerListClick: () => void
  onRoomControlsClick: () => void
  setIsQRCodeDialogOpen: (isOpen: boolean) => void
  showAppBar: boolean
  isFullscreen: boolean
  setIsFullscreen: (isFullscreen: boolean) => void
}

export const ShellAppBar = (_props: ShellAppBarProps) => {
  if (minimalUi.hideAppBar) {
    return null
  }

  // Non-minimal fallback: paste the original <Slide>…</Slide> + <Zoom>…</Zoom>
  // JSX from the current ShellAppBar.tsx here if you want the flag to be
  // toggleable at runtime. If minimal mode is permanent, `return null` alone
  // is the entire component.
  return null
}
