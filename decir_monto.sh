#!/bin/bash

if [ -z "$1" ]; then
    #echo "Uso: $0 '<Monto a indicar>'"
    exit 1
fi
number="$1"
DIGITS_PATH=""
currency_audio_file="[1026]-1754406097542"
cents_audio_file="[2056]-1754409695005"
decimal_line=""
decimal_part_first_two_digits=$(echo "$number" | awk -F'.' '{print substr($2, 1, 2)}')
if [[ "$decimal_part_first_two_digits" == "" || "$decimal_part_first_two_digits" == "0" || "$decimal_part_first_two_digits" == "00" ]]; then
    decimal_line="$decimal_line${DIGITS_PATH}0"
else
    decimal_line="${DIGITS_PATH}${decimal_part_first_two_digits}"
fi
decimal_line="$decimal_line&${cents_audio_file}"
integer_part="${number%%.*}"
declare -A digit_parts

current_integer_part="$integer_part"
pos=0
while [[ -n "$current_integer_part" ]]; do
    # Check if there are at least three digits left to extract
    if [[ ${#current_integer_part} -ge 3 ]]; then
        # Extract the last three digits and assign them to the current position
        digit_parts["$pos"]="${current_integer_part: -3}"
        # Remove the last three digits for the next iteration
        current_integer_part="${current_integer_part::-3}"
    else
        # Handle the final group of 1 or 2 digits
        digit_parts["$pos"]="$(printf "%03d" $current_integer_part)"
        current_integer_part=""
    fi
    pos=$((pos+1))
done

sorted_keys=($(echo "${!digit_parts[@]}" | tr ' ' '\n' | sort -n))

#echo "For the number \"$integer_part\", the associative array is:"
#for key in "${sorted_keys[@]}"; do
#    printf "[%s]=\"%s\"\n" "$key" "${digit_parts[$key]}"
#done

line=""
integer_line=""

for key in "${sorted_keys[@]}"; do
    fragment_integer_line=""
    digit_group=$(printf "${digit_parts[$key]}")
    hundreds_digit=${digit_group:0:1}
    tens_ones_digits=${digit_group:1:2}
    if [[ "$digit_group" -eq 100 ]]; then
        fragment_integer_line="${DIGITS_PATH}100"
    else
        if [[ "$tens_ones_digits" != "00" ]]; then
            if [[ "${tens_ones_digits:0:1}" != "0" ]]; then
                fragment_integer_line="${DIGITS_PATH}${tens_ones_digits}"
            else
                fragment_integer_line="${DIGITS_PATH}${tens_ones_digits:1:1}"
            fi
        fi
        if [[ "$hundreds_digit" != 0 ]]; then
            if [[ "$hundreds_digit" -eq 1 ]]; then
                fragment_integer_line="${DIGITS_PATH}ciento&${fragment_integer_line}"
            else
                fragment_integer_line="${DIGITS_PATH}${hundreds_digit}00&${fragment_integer_line}"
            fi
        fi
    fi
    if [[ "$digit_group" != "000" ]]; then
        case $key in
            1)
                fragment_integer_line="${fragment_integer_line}&${DIGITS_PATH}thousand"
            ;;
            2)
                if [[ "$digit_group" == "001" ]]; then
                    fragment_integer_line="${fragment_integer_line}&${DIGITS_PATH}million"
                else
                    fragment_integer_line="${fragment_integer_line}&${DIGITS_PATH}millions"
                fi
            ;;
            3)
                fragment_integer_line="${fragment_integer_line}&${DIGITS_PATH}thousand&${DIGITS_PATH}millions"
            ;;
            4)
                if [[ "$digit_group" == "001" ]]; then
                    fragment_integer_line="${fragment_integer_line}&${DIGITS_PATH}billion"
                else
                    fragment_integer_line="${fragment_integer_line}&${DIGITS_PATH}billions"
                fi
            ;;
            5)
                fragment_integer_line="${fragment_integer_line}&${DIGITS_PATH}thousand&${DIGITS_PATH}billions"
            ;;
            *)
            ;;
        esac
    fi
    line="$fragment_integer_line&$line"
done
line="${line}${currency_audio_file}&${decimal_line}"

echo "$line"
