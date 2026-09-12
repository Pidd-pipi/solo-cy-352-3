<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { cancelBooking } from "../../api/booking";
import { bookingState, refreshBookingData } from "../../state/booking";
import type { BookingItem } from "../../types";

const filterRoomId = ref("");
const filterStatus = ref<"" | "active" | "cancelled">("");

const filtered = computed(() =>
  bookingState.bookings.filter(
    (booking) =>
      (filterRoomId.value ? booking.roomId === filterRoomId.value : true) &&
      (filterStatus.value ? booking.status === filterStatus.value : true),
  ),
);

async function cancel(booking: BookingItem) {
  try {
    await ElMessageBox.confirm(
      `确定取消「${booking.roomName}」${booking.date} ${booking.startHour}:00-${booking.endHour}:00 的预约吗？已支付的 ¥${booking.amount.toFixed(2)} 将退回会员余额。`,
      "取消预约",
      { confirmButtonText: "取消预约", cancelButtonText: "再想想", type: "warning" },
    );
  } catch {
    return;
  }
  try {
    await cancelBooking(booking.id);
    ElMessage.success(`预约已取消，¥${booking.amount.toFixed(2)} 已退回「${booking.memberName}」的余额`);
    await refreshBookingData();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "取消失败");
    await refreshBookingData();
  }
}
</script>

<template>
  <section>
    <div class="panel-toolbar">
      <el-select v-model="filterRoomId" placeholder="全部包厢" clearable style="width: 180px">
        <el-option v-for="room in bookingState.rooms" :key="room.id" :value="room.id" :label="room.name" />
      </el-select>
      <el-radio-group v-model="filterStatus">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="active">进行中</el-radio-button>
        <el-radio-button value="cancelled">已取消</el-radio-button>
      </el-radio-group>
    </div>

    <el-table :data="filtered" style="width: 100%" size="large" empty-text="暂无预约记录">
      <el-table-column prop="date" label="日期" width="110" />
      <el-table-column label="时段" width="140">
        <template #default="{ row }">{{ row.startHour }}:00 - {{ row.endHour }}:00（{{ row.hours }}小时）</template>
      </el-table-column>
      <el-table-column prop="roomName" label="包厢" min-width="110" />
      <el-table-column prop="memberName" label="会员" min-width="100" />
      <el-table-column label="金额" width="170" align="right">
        <template #default="{ row }">
          <span v-if="row.discount < 1" class="original">¥{{ row.originalAmount.toFixed(2) }}</span>
          ¥{{ row.amount.toFixed(2) }}
        </template>
      </el-table-column>
      <el-table-column label="积分" width="80" align="right">
        <template #default="{ row }">+{{ row.pointsEarned }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">
            {{ row.status === "active" ? "进行中" : "已取消" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" align="center">
        <template #default="{ row }">
          <el-button v-if="row.status === 'active'" link type="danger" @click="cancel(row)">取消预约</el-button>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.original {
  text-decoration: line-through;
  color: #9aa3af;
  margin-right: 6px;
}

.muted {
  color: #9aa3af;
}
</style>
