<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { createRoom, deleteRoom, updateRoom } from "../../api/booking";
import { bookingState, refreshBookingData } from "../../state/booking";
import type { RoomItem } from "../../types";

const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);

const form = reactive({
  name: "",
  capacity: 4,
  facilities: [] as string[],
  pricePerHour: 38,
});

const facilityOptions = computed(() => bookingState.meta?.facilities ?? []);

function openCreate() {
  editingId.value = null;
  form.name = "";
  form.capacity = 4;
  form.facilities = [];
  form.pricePerHour = 38;
  dialogVisible.value = true;
}

function openEdit(room: RoomItem) {
  editingId.value = room.id;
  form.name = room.name;
  form.capacity = room.capacity;
  form.facilities = [...room.facilities];
  form.pricePerHour = room.pricePerHour;
  dialogVisible.value = true;
}

async function submit() {
  if (!form.name.trim()) {
    ElMessage.warning("请填写包厢名称");
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      capacity: form.capacity,
      facilities: form.facilities,
      pricePerHour: form.pricePerHour,
    };
    if (editingId.value) {
      await updateRoom(editingId.value, payload);
      ElMessage.success(`包厢「${payload.name}」已更新`);
    } else {
      await createRoom(payload);
      ElMessage.success(`包厢「${payload.name}」已添加`);
    }
    dialogVisible.value = false;
    await refreshBookingData();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

async function remove(room: RoomItem) {
  try {
    await ElMessageBox.confirm(`确定删除包厢「${room.name}」吗？`, "删除确认", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  try {
    await deleteRoom(room.id);
    ElMessage.success(`包厢「${room.name}」已删除`);
    await refreshBookingData();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "删除失败");
  }
}
</script>

<template>
  <section>
    <div class="panel-toolbar">
      <p class="panel-hint">维护包厢的名称、容纳人数、设施与每小时价格，预约时按此计费。</p>
      <el-button type="primary" @click="openCreate">新增包厢</el-button>
    </div>

    <el-table :data="bookingState.rooms" style="width: 100%" size="large" empty-text="还没有包厢，点击右上角新增">
      <el-table-column prop="name" label="包厢名称" min-width="130" />
      <el-table-column label="容纳人数" width="100" align="center">
        <template #default="{ row }">{{ row.capacity }} 人</template>
      </el-table-column>
      <el-table-column label="设施" min-width="240">
        <template #default="{ row }">
          <el-tag v-for="item in row.facilities" :key="item" size="small" class="facility-tag">{{ item }}</el-tag>
          <span v-if="row.facilities.length === 0" class="muted">暂无</span>
        </template>
      </el-table-column>
      <el-table-column label="价格" width="120" align="right">
        <template #default="{ row }">¥{{ row.pricePerHour.toFixed(2) }}/小时</template>
      </el-table-column>
      <el-table-column label="操作" width="150" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑包厢' : '新增包厢'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="包厢名称" required>
          <el-input v-model="form.name" placeholder="如：翡翠小包" maxlength="20" />
        </el-form-item>
        <el-form-item label="容纳人数" required>
          <el-input-number v-model="form.capacity" :min="1" :max="50" />
        </el-form-item>
        <el-form-item label="每小时价格" required>
          <el-input-number v-model="form.pricePerHour" :min="1" :max="9999" :precision="2" />
        </el-form-item>
        <el-form-item label="设施">
          <el-checkbox-group v-model="form.facilities">
            <el-checkbox v-for="item in facilityOptions" :key="item" :value="item">{{ item }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.panel-hint {
  margin: 0;
  color: #5b6675;
}

.facility-tag {
  margin-right: 6px;
}

.muted {
  color: #9aa3af;
}
</style>
