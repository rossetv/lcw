# LCW's status line player. The status line command sources it in the shell Claude Code starts, with Claude Code's
# input on stdin: it prints the frame saved for this second when nothing the rows show has changed since it was
# drawn, and otherwise has Node draw. It always prints rows and ends the shell with status 0. Setup copies it to
# <LCW home>/bin as it is. POSIX: sh, bash, zsh and dash, with builtins and one `date` on a tick that plays a frame.
# What it reads is laid out in scripts/statusline.mjs, beside `ahead`.
#
# Kept fast on purpose: no ${v#*x} or ${v##*x} on the input past its first field (their cost grows with the square
# of the length in bash 3.2 and dash), and the input is checked by one walk over the pieces Node saved.
lcw_lc=${LC_ALL-} lcw_lcset=${LC_ALL+1}
# Bytes, not characters: bash 3.2 converts each string it compares otherwise, and [A-Za-z] stays ASCII.
LC_ALL=C
lcw_nl='
'
lcw_h=${LCW_HOME:-$HOME/.lcw}
# The launcher is in the folder the status line command names in lcw_bin, else in the LCW home; frames, records and
# the log are always in the LCW home.
lcw_launcher=${lcw_bin:-$lcw_h/bin}/statusline.mjs
lcw_in= lcw_l=
IFS= read -r lcw_in
while IFS= read -r lcw_l || [ -n "$lcw_l" ]; do lcw_in=$lcw_in$lcw_nl$lcw_l; lcw_l=; done
lcw_now=$(exec date +%s%z 2>/dev/null)
lcw_s=${lcw_now%[+-][0-9][0-9][0-9][0-9]}; lcw_z=${lcw_now#"$lcw_s"}
case $lcw_s in ''|*[!0-9]*|0*) lcw_s= lcw_now= ;; esac
lcw_sid=${lcw_in#*\"session_id\":\"}
if [ "$lcw_sid" = "$lcw_in" ]; then lcw_sid=; else lcw_sid=${lcw_sid%%\"*}; fi
case $lcw_sid in *[!A-Za-z0-9_-]*) lcw_sid= ;; esac

# Prints the frame for this second when every check holds; returns 1 at the first that does not.
lcw_play() {
  [ -n "$lcw_s" ] && [ -n "$lcw_sid" ] || return 1
  lcw_d=$lcw_h/frames/$lcw_sid
  lcw_key=$lcw_d/key
  [ -r "$lcw_key" ] || return 1
  {
    IFS= read -r lcw_l && [ "$lcw_l" = "${COLUMNS:-0} ${LCW_THEME:-dark} $lcw_z" ] || return 1
    IFS= read -r lcw_beat && IFS= read -r lcw_tag && IFS= read -r lcw_D || return 1
    while IFS= read -r lcw_w; do
      case $lcw_w in
        "$lcw_D") break ;;
        /*) [ -e "$lcw_w" ] || return 1; [ "$lcw_w" -nt "$lcw_key" ] && return 1 ;;
        '!'*) [ -e "${lcw_w#?}" ] && return 1 ;;
        '%'*) [ -e "${lcw_w#?}" ] || return 1 ;;
        '+'*) kill -0 "${lcw_w#?}" 2>/dev/null || return 1 ;;
        *) return 1 ;;
      esac
    done
    # The input against the pieces: before each piece after the first stands all that came before it and one value
    # of [0-9A-Za-z.+-], and at the end the input is all of it. So only those values can differ.
    lcw_pre= lcw_st= lcw_p= lcw_fl=1
    while IFS= read -r lcw_l; do
      if [ "$lcw_l" != "$lcw_D" ]; then
        if [ -n "$lcw_fl" ]; then lcw_p=$lcw_l lcw_fl=; else lcw_p=$lcw_p$lcw_nl$lcw_l; fi
      else
        lcw_fl=1
        if [ -z "$lcw_st" ]; then lcw_pre=$lcw_p lcw_st=1
        else
          lcw_hd=${lcw_in%%"$lcw_p"*}
          case $lcw_hd in
            "$lcw_pre") return 1 ;;
            "$lcw_pre"*[!0-9A-Za-z.+-]*) return 1 ;;
            "$lcw_pre"*) ;;
            *) return 1 ;;
          esac
          lcw_pre=$lcw_hd$lcw_p
        fi
      fi
    done
    [ -n "$lcw_st" ] && [ "$lcw_in" = "$lcw_pre" ] || return 1
  } < "$lcw_key"
  # The heartbeat is judged by its number against the clock, so a fresh one changes nothing. A frame is played only
  # in a second where the mod runs at every moment of it (the heartbeat at most 14 whole seconds old) or at none (16
  # or more), both by the heartbeat there is now and by the one the frame was drawn with; in the second between,
  # whether the mod runs depends on the millisecond, and Node draws.
  if [ -n "$lcw_beat" ]; then
    lcw_ms=
    [ -r "${lcw_beat% *}" ] && IFS= read -r lcw_ms < "${lcw_beat% *}"
    case $lcw_ms in '') lcw_ms=0 ;; *[!0-9]*|0?*|????????????????*) return 1 ;; esac
    lcw_w=${lcw_beat##* }
    case $lcw_w in ''|*[!0-9]*|????????????????*) return 1 ;; esac
    lcw_l=$((lcw_s - lcw_ms / 1000)) lcw_w=$((lcw_s - lcw_w))
    if [ "$lcw_l" -le 14 ]; then [ "$lcw_w" -le 14 ] || return 1
    else [ "$lcw_l" -ge 16 ] && [ "$lcw_w" -ge 16 ] || return 1; fi
  fi
  lcw_f=$lcw_d/$lcw_tag/$lcw_s
  [ -r "$lcw_f" ] || return 1
  lcw_out= lcw_l=
  while IFS= read -r lcw_l || [ -n "$lcw_l" ]; do lcw_out=$lcw_out$lcw_l$lcw_nl; lcw_l=; done < "$lcw_f"
  [ -n "$lcw_out" ] || return 1
  printf '%s' "$lcw_out"
}
lcw_play && exit 0

# Node draws, under the locale the shell had, for the second read above.
if [ -r "$lcw_launcher" ]; then
  lcw_out=$(if [ -n "$lcw_lcset" ]; then LC_ALL=$lcw_lc; else unset LC_ALL; fi
    printf '%s' "$lcw_in" | node "$lcw_launcher" ${lcw_now:+"$lcw_now"} 2>/dev/null; printf ' %s' "$?")
  lcw_r=${lcw_out##* }; lcw_out=${lcw_out% *}
  if [ "$lcw_r" = 0 ] && [ -n "$lcw_out" ]; then printf '%s' "$lcw_out"; exit 0; fi
  case $lcw_r in
    127) lcw_m="node was not found: put Node on the PATH that Claude Code runs the status line with" ;;
    *) lcw_m="the status line's launcher $lcw_launcher ended with status $lcw_r and printed nothing: run LCW setup again to put it back, or run it in a terminal to see why" ;;
  esac
else
  lcw_m="$lcw_launcher is missing: run LCW setup again"
fi

# Nothing drawn: one line in the log, then the session's last rows. A fault one of the last 8 lines already gives is
# not written again, so the faults of a few sessions that take turns add nothing, and the log is never taken past
# 64 KB here (Node cuts it to its newest half when it writes).
lcw_log=$lcw_h/statusline.log
lcw_r1= lcw_r2= lcw_r3= lcw_r4= lcw_r5= lcw_r6= lcw_r7= lcw_r8= lcw_q=0
if [ -f "$lcw_log" ] && [ -r "$lcw_log" ]; then
  while IFS= read -r lcw_w; do
    lcw_q=$((lcw_q + ${#lcw_w} + 1))
    lcw_r8=$lcw_r7 lcw_r7=$lcw_r6 lcw_r6=$lcw_r5 lcw_r5=$lcw_r4 lcw_r4=$lcw_r3 lcw_r3=$lcw_r2 lcw_r2=$lcw_r1 lcw_r1=${lcw_w#* }
  done < "$lcw_log"
fi
case $lcw_m in "$lcw_r1"|"$lcw_r2"|"$lcw_r3"|"$lcw_r4"|"$lcw_r5"|"$lcw_r6"|"$lcw_r7"|"$lcw_r8") lcw_q=65536 ;; esac
if [ $((lcw_q + ${#lcw_m} + 22)) -le 65536 ]; then
  if [ -n "$lcw_s" ]; then
    # The UTC date of the second, from the days since 1970 (H. Hinnant's civil_from_days).
    lcw_q=$((lcw_s / 86400 + 719468)); lcw_e=$((lcw_q / 146097)); lcw_q=$((lcw_q - lcw_e * 146097))
    lcw_y=$(( (lcw_q - lcw_q / 1460 + lcw_q / 36524 - lcw_q / 146096) / 365 ))
    lcw_dy=$((lcw_q - (365 * lcw_y + lcw_y / 4 - lcw_y / 100))); lcw_mp=$(( (5 * lcw_dy + 2) / 153 ))
    lcw_dd=$((lcw_dy - (153 * lcw_mp + 2) / 5 + 1)); lcw_mo=$((lcw_mp < 10 ? lcw_mp + 3 : lcw_mp - 9))
    lcw_y=$((lcw_y + lcw_e * 400 + (lcw_mo <= 2))); lcw_q=$((lcw_s % 86400))
    { printf '%04d-%02d-%02dT%02d:%02d:%02dZ %s\n' "$lcw_y" "$lcw_mo" "$lcw_dd" $((lcw_q / 3600)) $((lcw_q / 60 % 60)) $((lcw_q % 60)) "$lcw_m" >> "$lcw_log"; } 2>/dev/null
  else
    { printf '%s %s\n' '?' "$lcw_m" >> "$lcw_log"; } 2>/dev/null
  fi
fi
lcw_out= lcw_l=
lcw_f=$lcw_h/frames/$lcw_sid/last
if [ -n "$lcw_sid" ] && [ -r "$lcw_f" ]; then
  while IFS= read -r lcw_l || [ -n "$lcw_l" ]; do lcw_out=$lcw_out$lcw_l$lcw_nl; lcw_l=; done < "$lcw_f"
fi
[ -n "$lcw_out" ] || lcw_out="LCW · status line could not load · see ~/.lcw/statusline.log$lcw_nl"
printf '%s' "$lcw_out"
exit 0
