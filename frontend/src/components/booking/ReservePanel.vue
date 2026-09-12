<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { createBooking } from "../../api/booking";
import { bookingState, discountText, levelDiscount, refreshBookingData } from "../../state/booking";
import type { MemberItem, RoomItem } from "../../types";

function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const form = reactive({
  roomId: "",
  date: todayString(),
  startHour: null as number | null,
  hours: 1,
  memberId: "",
});

const submitting = ref(false);

const openHour = computed(() => bookingState.meta?.openHour ?? 10);
const closeHour = computed(() => bookingState.meta?.closeHour ?? 23);
const pointsPerYuan = computed(() => bookingState.meta?.pointsPerYuan ?? 1);

const selectedRoom = computed<RoomItem | null>(() => bookingState.rooms.find((room) => room.id === form.roomId) ?? null);
const selectedMember = computed<MemberItem | null>(() => bookingState.members.find((member) => member.id === form.memberId) ?? null);

const dayBookings = computed(() =>
  bookingState.bookings.filter(
    (booking) => booking.roomId === form.roomId && booking.date === form.date && booking.status === "active",
  ),
);

interface Slot {
  hour: number;
  bookedBy: string | null;
  selected: boolean;
}

const slots = computed<Slot[]>(() => {
  const result: Slot[] = [];
  for (let hour = openHour.value; hour < closeHour.value; hour += 1) {
    const hit = dayBookings.value.find((booking) => booking.startHour <= hour && hour < booking.endHour);
    result.push({
      hour,
      bookedBy: hit ? hit.memberName : null,
      selected: form.startHour !== null && form.startHour <= hour && hour < form.startHour + form.hours,
    });
  }
  return result;
});

const maxHours = computed(() => {
  if (form.startHour === null) return 0;
  const nextBooked = dayBookings.value
    .filter((booking) => booking.startHour > (form.startHour as number))
    .map((booking) => booking.startHour)
    .sort((a, b) => a - b)[0];
  return Math.min(closeHour.value, nextBooked ?? closeHour.value) - form.startHour;
});

const pricing = computed(() => {
  if (!selectedRoom.value || form.startHour === null) return null;
  const original = selectedRoom.value.pricePerHour * form.hours;
  const discount = selectedMember.value ? levelDiscount(selectedMember.value.level) : 1;
  const amount = Math.round(original * discount * 100) / 100;
  return {
    original,
    discount,
    amount,
    points: Math.floor(amount * pointsPerYuan.value),
    balance: selectedMember.value?.balance ?? null,
    insufficient: selectedMember.value ? selectedMember.value.balance < amount : false,
  };
});

function pickSlot(hour: number, bookedBy: string | null) {
  if (bookedBy) {
    ElMessage.warning(`${hour}:00 时段已被 ${bookedBy} 预约，请选择其他时段`);
    return;
  }
  form.startHour = hour;
  form.hours = 1;
}

watch([() => form.roomId, () => form.date], () => {
  form.startHour = null;
  form.hours = 1;
});

function disablePast(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

async function submit() {
  if (!form.roomId) {
    ElMessage.warning("请选择包厢");
    return;
  }
  if (form.startHour === null) {
    ElMessage.warning("请在下方时段表中选择开始时间");
    return;
  }
  if (!form.memberId) {
    ElMessage.warning("请选择支付会员");
    return;
  }
  submitting.value = true;
  try {
    const booking = await createBooking({
      roomId: form.roomId,
      memberId: form.memberId,
      date: form.date,
      startHour: form.startHour,
      hours: form.hours,
    });
    ElMessage.success(
      `预约成功：「${booking.roomName}」${booking.date} ${booking.startHour}:00-${booking.endHour}:00，实付 ¥${booking.amount.toFixed(2)}，累计积分 +${booking.pointsEarned}`,
    );
    form.startHour = null;
    form.hours = 1;
    await refreshBookingData();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "预约失败");
    await refreshBookingData();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="reserve-grid">
    <div class="reserve-form">
      <el-form label-width="90px">
        <el-form-item label="包厢" required>
          <el-select v-model="form.roomId" placeholder="选择包厢" style="width: 100%">
            <el-option v-for="room in bookingState.rooms" :key="room.id" :value="room.id"
              :label="`${room.name}（${room.capacity}人 · ¥${room.pricePerHour}/小时）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" :disabled-date="disablePast"
            :clearable="false" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="form.startHour !== null" label="时长" required>
          <el-select v-model="form.hours" style="width: 100%">
            <el-option v-for="hour in maxHours" :key="hour" :value="hour"
              :label="`${hour} 小时（${form.startHour}:00 - ${(form.startHour ?? 0) + hour}:00）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="支付会员" required>
          <el-select v-model="form.memberId" placeholder="选择会员" style="width: 100%">
            <el-option v-for="member in bookingState.members" :key="member.id" :value="member.id"
              :label="`${member.name}（余额 ¥${member.balance.toFixed(2)}）`" />
          </el-select>
        </el-form-item>
      </el-form>

      <div v-if="selectedRoom" class="room-brief">
        <strong>{{ selectedRoom.name }}</strong>
        <span>容纳 {{ selectedRoom.capacity }} 人</span>
        <el-tag v-for="item in selectedRoom.facilities" :key="item" size="small" class="facility-tag">{{ item }}</el-tag>
      </div>

      <div v-if="pricing" class="price-box" :class="{ warn: pricing.insufficient }">
        <template v-if="selectedMember">
          <p v-if="pricing.discount < 1">原价：¥{{ pricing.original.toFixed(2) }} × {{ discountText(pricing.discount) }}折</p>
          <p v-else>原价：¥{{ pricing.original.toFixed(2) }}（当前等级无折扣）</p>
          <p class="price-final">实付：¥{{ pricing.amount.toFixed(2) }}<span class="points">（积分 +{{ pricing.points }}）</span></p>
          <p>当前余额：¥{{ (pricing.balance ?? 0).toFixed(2) }}</p>
          <p v-if="pricing.insufficient" class="insufficient">
            余额不足，还差 ¥{{ (pricing.amount - (pricing.balance ?? 0)).toFixed(2) }}，请先到「会员储值」充值
          </p>
        </template>
        <p v-else>选择会员后显示折后价格</p>
      </div>

      <el-button type="primary" size="large" :loading="submitting" :disabled="!form.roomId || form.startHour === null || !form.memberId"
        @click="submit">
        确认预约并支付
      </el-button>
    </div>

    <div class="slot-panel">
      <p class="slot-title">
        时段占用（{{ form.date }}）
        <span v-if="!form.roomId" class="muted">请先选择包厢</span>
      </p>
      <div class="slot-grid">
        <button v-for="slot in slots" :key="slot.hour" type="button" class="slot"
          :class="{ booked: slot.bookedBy !== null, selected: slot.selected }"
          @click="pickSlot(slot.hour, slot.bookedBy)">
          <span class="slot-hour">{{ slot.hour }}:00</span>
          <span class="slot-state">{{ slot.bookedBy ?? "可预约" }}</span>
        </button>
      </div>
      <p class="slot-legend">
        <span class="legend free"></span>可预约
        <span class="legend taken"></span>已被预约
        <span class="legend picking"></span>当前选择
      </p>
    </div>
  </section>
</template>

<style scoped>
.reserve-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(320px, 1fr);
  gap: 28px;
}

@media (max-width: 860px) {
  .reserve-grid {
    grid-template-columns: 1fr;
  }
}

.room-brief {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 4px 0 16px;
  color: #5b6675;
}

.facility-tag {
  margin-right: 2px;
}

.price-box {
  border: 1px solid #cfd9e6;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: #f7fafd;
}

.price-box.warn {
  border-color: #cf5c36;
  background: #fdf3ee;
}

.price-box p {
  margin: 4px 0;
}

.price-final {
  font-size: 18px;
  font-weight: 800;
}

.points {
  font-size: 13px;
  font-weight: 500;
  color: #3268b8;
}

.insufficient {
  color: #cf5c36;
  font-weight: 700;
}

.slot-title {
  margin: 0 0 12px;
  font-weight: 700;
}

.muted {
  color: #9aa3af;
  font-weight: 400;
  margin-left: 8px;
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
}

.slot {
  border: 1px solid #cfd9e6;
  border-radius: 8px;
  background: #ffffff;
  padding: 8px 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  transition: all 0.15s ease;
}

.slot:hover:not(.booked) {
  border-color: #3268b8;
}

.slot.booked {
  background: #eceff3;
  color: #9aa3af;
  cursor: not-allowed;
}

.slot.selected {
  background: #3268b8;
  border-color: #3268b8;
  color: #ffffff;
}

.slot-hour {
  font-weight: 800;
}

.slot-state {
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 0;
  color: #5b6675;
  font-size: 13px;
}

.legend {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-left: 10px;
}

.legend.free {
  background: #ffffff;
  border: 1px solid #cfd9e6;
}

.legend.taken {
  background: #eceff3;
  border: 1px solid #d5dbe3;
}

.legend.picking {
  background: #3268b8;
}
</style>
